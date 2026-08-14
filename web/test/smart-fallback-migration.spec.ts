/**
 * ============================================================================
 * api-issue / api-org 新增 smart 单元测试 —— PR commits/CI/协作者 + 组织成员/团队
 * ============================================================================
 *
 * 【本文件针对的验收基线（第一性原理，勿降断言）】
 * 全量迁移补全的 6 个 smart 函数，均遵循「登录态 GraphQL 唯一主通道 + REST 熔断降级」：
 * - fetchPullCommitsSmart：GraphQL PullRequest.commits → REST GET /pulls/{n}/commits
 * - fetchPullCheckRunsSmart：GraphQL Commit.statusCheckRollup（CheckRun union）→ REST checks.listForRef
 * - fetchCollaboratorsSmart：GraphQL Repository.collaborators → REST listCollaborators
 * - fetchOrgMembersWithRolesSmart：GraphQL membersWithRole.edges（role+2FA 单请求）→ REST 2 请求合并
 * - fetchOrgTeamsSmart：GraphQL Organization.teams → REST teams.list
 * - fetchTeamMembersSmart：GraphQL teams(query:slug).members → REST teams.listMembersInOrg
 *
 * 【测试方式与风控红线】全部 mock（graphqlRequest / rest 层），**零真实网络请求**。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/api/api-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/api-core")>();
  return {
    ...actual,
    graphqlRequest: vi.fn(),
    hasGraphQLErrors: (resp: { errors?: unknown[] } | undefined) => Boolean(resp?.errors?.length),
  };
});

vi.mock("@/lib/restapi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/restapi")>();
  return {
    ...actual,
    fetchPullCommits: vi.fn(),
    fetchPullCheckRuns: vi.fn(),
    fetchCollaborators: vi.fn(),
    fetchOrgMembersWithRoles: vi.fn(),
    fetchOrgTeams: vi.fn(),
    fetchTeamMembers: vi.fn(),
  };
});

import {
  fetchPullCommitsSmart,
  fetchPullCheckRunsSmart,
  fetchPullCheckRunsBatchSmart,
  fetchCollaboratorsSmart,
} from "@/lib/api/api-review";
import {
  fetchOrgMembersWithRolesSmart,
  fetchOrgTeamsSmart,
  fetchTeamMembersSmart,
} from "@/lib/api/api-org";
import { graphqlRequest } from "@/lib/api/api-core";
import {
  fetchPullCommits,
  fetchPullCheckRuns,
  fetchCollaborators,
  fetchOrgMembersWithRoles,
  fetchOrgTeams,
  fetchTeamMembers,
  type PullCommit,
  type CheckRunsSummary,
  type Collaborator,
  type OrgMemberWithRole,
  type OrgTeam,
  type OrgMember,
} from "@/lib/restapi";

const mockGraphql = vi.mocked(graphqlRequest);
const mockFetchPullCommits = vi.mocked(fetchPullCommits);
const mockFetchPullCheckRuns = vi.mocked(fetchPullCheckRuns);
const mockFetchCollaborators = vi.mocked(fetchCollaborators);
const mockFetchOrgMembersWithRoles = vi.mocked(fetchOrgMembersWithRoles);
const mockFetchOrgTeams = vi.mocked(fetchOrgTeams);
const mockFetchTeamMembers = vi.mocked(fetchTeamMembers);

const restCommit: PullCommit = {
  sha: "abc123",
  commit: { message: "msg", author: { name: "A", email: "a@x", date: "2026-07-01T00:00:00Z" } },
  author: { login: "alice", avatar_url: "https://avatars/a.png" },
  committer: { login: "bob" },
};

const restChecks: CheckRunsSummary = { total: 2, success: 1, failure: 0, pending: 1 };

const restCollaborator: Collaborator = { login: "alice", avatar_url: "https://avatars/a.png" };

const restMember: OrgMemberWithRole = {
  login: "alice",
  avatar_url: "https://avatars/a.png",
  html_url: "https://github.com/alice",
  two_factor_authentication: true,
  role: "admin",
};

const restTeam: OrgTeam = {
  id: 1,
  node_id: "T_1",
  name: "core",
  slug: "core",
  description: "core team",
  privacy: "closed",
  permission: "pull",
  members_count: 3,
  html_url: "https://github.com/orgs/evil7/teams/core",
};

const restTeamMember: OrgMember = {
  login: "alice",
  avatar_url: "https://avatars/a.png",
  html_url: "https://github.com/alice",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGraphql.mockResolvedValue({ data: {} } as never);
  mockFetchPullCommits.mockResolvedValue([restCommit]);
  mockFetchPullCheckRuns.mockResolvedValue(restChecks);
  mockFetchCollaborators.mockResolvedValue([restCollaborator]);
  mockFetchOrgMembersWithRoles.mockResolvedValue([restMember]);
  mockFetchOrgTeams.mockResolvedValue([restTeam]);
  mockFetchTeamMembers.mockResolvedValue([restTeamMember]);
});

describe("fetchPullCommitsSmart（GraphQL PullRequest.commits 首选 + 降级）", () => {
  it("token 为空 → REST", async () => {
    const r = await fetchPullCommitsSmart("evil7", "puregit", 7, undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchPullCommits).toHaveBeenCalled();
    expect(r[0].sha).toBe("abc123");
  });

  it("GraphQL 成功 → Commit 字段映射（oid/message/author GitActor）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          pullRequest: {
            commits: {
              nodes: [
                {
                  commit: {
                    oid: "sha1",
                    message: "feat",
                    committedDate: "2026-07-01T00:00:00Z",
                    author: {
                      name: "Alice",
                      email: "a@x",
                      date: "2026-07-01T00:00:00Z",
                      user: { login: "alice" },
                      avatarUrl: "https://avatars/a.png",
                    },
                    committer: { user: { login: "bob" } },
                  },
                },
              ],
            },
          },
        },
      },
    } as never);
    const r = await fetchPullCommitsSmart("evil7", "puregit", 7, "gho_x");
    expect(mockFetchPullCommits).not.toHaveBeenCalled();
    expect(r[0].sha).toBe("sha1");
    expect(r[0].commit.message).toBe("feat");
    expect(r[0].commit.author.name).toBe("Alice");
    expect(r[0].author?.login).toBe("alice");
    expect(r[0].committer?.login).toBe("bob");
  });

  it("GraphQL errors / 异常 → 熔断降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchPullCommitsSmart("evil7", "puregit", 7, "gho_x"))[0].sha).toBe("abc123");
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchPullCommitsSmart("evil7", "puregit", 7, "gho_x"))[0].sha).toBe("abc123");
    expect(mockFetchPullCommits).toHaveBeenCalledTimes(2);
  });
});

describe("fetchPullCheckRunsSmart（GraphQL statusCheckRollup 首选 + 降级）", () => {
  it("token 为空 → REST", async () => {
    const r = await fetchPullCheckRunsSmart("evil7", "puregit", "abc", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchPullCheckRuns).toHaveBeenCalled();
    expect(r?.total).toBe(2);
  });

  it("GraphQL 成功 → 状态汇总（COMPLETED/SUCCESS + 失败 + 进行中 + neutral）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          object: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  { status: "COMPLETED", conclusion: "SUCCESS" },
                  { status: "COMPLETED", conclusion: "FAILURE" },
                  { status: "IN_PROGRESS", conclusion: null },
                  { status: "COMPLETED", conclusion: "NEUTRAL" },
                ],
              },
            },
          },
        },
      },
    } as never);
    const r = await fetchPullCheckRunsSmart("evil7", "puregit", "abc", "gho_x");
    expect(mockFetchPullCheckRuns).not.toHaveBeenCalled();
    expect(r).toEqual({ total: 4, success: 1, failure: 1, pending: 2 });
  });

  it("GraphQL 成功但无 check-runs → null（官方显示无 checks）", async () => {
    mockGraphql.mockResolvedValue({
      data: { repository: { object: { statusCheckRollup: { contexts: { nodes: [] } } } } },
    } as never);
    const r = await fetchPullCheckRunsSmart("evil7", "puregit", "abc", "gho_x");
    expect(r).toBeNull();
  });

  it("GraphQL errors / 异常 → 熔断降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchPullCheckRunsSmart("evil7", "puregit", "abc", "gho_x"))?.total).toBe(2);
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchPullCheckRunsSmart("evil7", "puregit", "abc", "gho_x"))?.total).toBe(2);
    expect(mockFetchPullCheckRuns).toHaveBeenCalledTimes(2);
  });
});

describe("fetchPullCheckRunsBatchSmart（列表页批量合并：别名 object(expression) 一次拿全部）", () => {
  it("token 为空 → 返回空 Map（匿名列表无 CI 图标）", async () => {
    const r = await fetchPullCheckRunsBatchSmart("evil7", "puregit", ["a", "b"], undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(r.size).toBe(0);
  });

  it("shas 为空 → 空 Map，不请求", async () => {
    const r = await fetchPullCheckRunsBatchSmart("evil7", "puregit", [], "gho_x");
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(r.size).toBe(0);
  });

  it("GraphQL 成功：一次请求含全部别名（≤10），按 sha 映射汇总（无 CI → null）", async () => {
    const shas = Array.from({ length: 10 }, (_, i) => `sha${i}`);
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          c0: {
            statusCheckRollup: {
              contexts: { nodes: [{ status: "COMPLETED", conclusion: "SUCCESS" }] },
            },
          },
          c1: {
            statusCheckRollup: {
              contexts: { nodes: [{ status: "COMPLETED", conclusion: "FAILURE" }] },
            },
          },
          // c2..c9 无 rollup（无 CI）
        },
      },
    } as never);
    const r = await fetchPullCheckRunsBatchSmart("evil7", "puregit", shas, "gho_x");
    expect(mockGraphql).toHaveBeenCalledTimes(1);
    expect(r.size).toBe(10);
    expect(r.get("sha0")).toEqual({ total: 1, success: 1, failure: 0, pending: 0 });
    expect(r.get("sha1")).toEqual({ total: 1, success: 0, failure: 1, pending: 0 });
    expect(r.get("sha2")).toBeNull(); // 无 rollup → null
    // 请求体含 10 个别名（c0..c9）——单请求批量合并
    const query = mockGraphql.mock.calls[0][0] as string;
    expect(query).toContain("c0: object(expression:");
    expect(query).toContain("c9: object(expression:");
  });

  it(">10 个 shas 分片：每批 10 个别名，循环请求直至取完", async () => {
    const shas = Array.from({ length: 25 }, (_, i) => `sha${i}`);
    mockGraphql.mockResolvedValue({
      data: { repository: { c0: { statusCheckRollup: null } } },
    } as never);
    const r = await fetchPullCheckRunsBatchSmart("evil7", "puregit", shas, "gho_x");
    expect(mockGraphql).toHaveBeenCalledTimes(3); // 25 = 10 + 10 + 5
    expect(r.size).toBe(25);
  });

  it("GraphQL errors → 本批逐 sha 熔断降级 REST 单查", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "boom" }] } as never);
    const r = await fetchPullCheckRunsBatchSmart("evil7", "puregit", ["a", "b"], "gho_x");
    expect(mockFetchPullCheckRuns).toHaveBeenCalledTimes(2); // 每 sha 一次 REST 降级
    expect(r.get("a")).toEqual({ total: 2, success: 1, failure: 0, pending: 1 });
  });
});

describe("fetchCollaboratorsSmart（GraphQL Repository.collaborators 首选 + 降级）", () => {
  it("token 为空 → REST", async () => {
    const r = await fetchCollaboratorsSmart("evil7", "puregit", undefined);
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(mockFetchCollaborators).toHaveBeenCalled();
    expect(r[0].login).toBe("alice");
  });

  it("GraphQL 成功 → login/avatarUrl 映射", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        repository: {
          collaborators: { nodes: [{ login: "bob", avatarUrl: "https://avatars/b.png" }] },
        },
      },
    } as never);
    const r = await fetchCollaboratorsSmart("evil7", "puregit", "gho_x");
    expect(mockFetchCollaborators).not.toHaveBeenCalled();
    expect(r[0]).toEqual({ login: "bob", avatar_url: "https://avatars/b.png" });
  });

  it("GraphQL errors / 异常 → 熔断降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchCollaboratorsSmart("evil7", "puregit", "gho_x"))[0].login).toBe("alice");
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchCollaboratorsSmart("evil7", "puregit", "gho_x"))[0].login).toBe("alice");
    expect(mockFetchCollaborators).toHaveBeenCalledTimes(2);
  });
});

describe("fetchOrgMembersWithRolesSmart（GraphQL membersWithRole.edges 首选 + 降级）", () => {
  it("GraphQL 成功 → role 归一化小写 + 2FA 映射（单请求）", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        organization: {
          membersWithRole: {
            edges: [
              {
                role: "ADMIN",
                hasTwoFactorEnabled: true,
                node: {
                  login: "alice",
                  avatarUrl: "https://avatars/a.png",
                  url: "https://github.com/alice",
                },
              },
              {
                role: "MEMBER",
                hasTwoFactorEnabled: false,
                node: {
                  login: "bob",
                  avatarUrl: "https://avatars/b.png",
                  url: "https://github.com/bob",
                },
              },
            ],
          },
        },
      },
    } as never);
    const r = await fetchOrgMembersWithRolesSmart("evil7", "gho_x");
    expect(mockFetchOrgMembersWithRoles).not.toHaveBeenCalled();
    expect(r[0]).toEqual({
      login: "alice",
      avatar_url: "https://avatars/a.png",
      html_url: "https://github.com/alice",
      two_factor_authentication: true,
      role: "admin",
    });
    expect(r[1].role).toBe("member");
    expect(r[1].two_factor_authentication).toBe(false);
  });

  it("GraphQL errors / 异常 → 熔断降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchOrgMembersWithRolesSmart("evil7", "gho_x"))[0].role).toBe("admin");
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchOrgMembersWithRolesSmart("evil7", "gho_x"))[0].role).toBe("admin");
    expect(mockFetchOrgMembersWithRoles).toHaveBeenCalledTimes(2);
  });
});

describe("fetchOrgTeamsSmart（GraphQL Organization.teams 首选 + 降级）", () => {
  it("GraphQL 成功 → databaseId/privacy 归一化 + members_count 映射", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        organization: {
          teams: {
            nodes: [
              {
                id: "T_1",
                databaseId: 1,
                name: "core",
                slug: "core",
                description: "core team",
                privacy: "CLOSED",
                members: { totalCount: 3 },
              },
              {
                id: "T_2",
                databaseId: 2,
                name: "secret-team",
                slug: "secret-team",
                description: null,
                privacy: "SECRET",
                members: { totalCount: 0 },
              },
            ],
          },
        },
      },
    } as never);
    const r = await fetchOrgTeamsSmart("evil7", "gho_x");
    expect(mockFetchOrgTeams).not.toHaveBeenCalled();
    expect(r[0].id).toBe(1);
    expect(r[0].privacy).toBe("closed");
    expect(r[0].members_count).toBe(3);
    expect(r[1].privacy).toBe("secret");
  });

  it("GraphQL errors / 异常 → 熔断降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchOrgTeamsSmart("evil7", "gho_x"))[0].slug).toBe("core");
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchOrgTeamsSmart("evil7", "gho_x"))[0].slug).toBe("core");
    expect(mockFetchOrgTeams).toHaveBeenCalledTimes(2);
  });
});

describe("fetchTeamMembersSmart（GraphQL teams(query:slug).members 首选 + 降级）", () => {
  it("GraphQL 成功 → 成员映射", async () => {
    mockGraphql.mockResolvedValue({
      data: {
        organization: {
          teams: {
            nodes: [
              {
                members: {
                  nodes: [
                    {
                      login: "bob",
                      avatarUrl: "https://avatars/b.png",
                      url: "https://github.com/bob",
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    } as never);
    const r = await fetchTeamMembersSmart("evil7", "core", "gho_x");
    expect(mockFetchTeamMembers).not.toHaveBeenCalled();
    expect(r[0]).toEqual({
      login: "bob",
      avatar_url: "https://avatars/b.png",
      html_url: "https://github.com/bob",
    });
  });

  it("GraphQL errors / 异常 → 熔断降级 REST", async () => {
    mockGraphql.mockResolvedValue({ errors: [{ message: "x" }] } as never);
    expect((await fetchTeamMembersSmart("evil7", "core", "gho_x"))[0].login).toBe("alice");
    mockGraphql.mockRejectedValue(new Error("net"));
    expect((await fetchTeamMembersSmart("evil7", "core", "gho_x"))[0].login).toBe("alice");
    expect(mockFetchTeamMembers).toHaveBeenCalledTimes(2);
  });
});
