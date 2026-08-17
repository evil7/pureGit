/**
 * API / 页面对照查询 CLI（v0.0.1 工具基建 · v2 重写）
 *
 * 定位：综合性的「远端 + 本地」常驻 debug 辅助工具——REST 端点精确搜索 + GraphQL schema
 * 递进枚举，**双端点「graph→rest 熔断对等」关系交由人主观判断**（不再用启发式自动配对强制提示）。
 *
 * 数据源：
 * - REST：`scripts/data/rest-index.json`（rest-index.mjs 生成，零下载转录 @octokit/openapi）
 * - GraphQL：实时直连官方 `https://api.github.com/graphql`（GITHUB_TOKEN 鉴权）做 introspection，
 *   失败/无 token 降级本地 `@octokit/graphql-schema`（见 gql-schema.mjs）
 * - 页面：`scripts/data/pages-index.json`（page-index.mjs 生成）
 *
 * 子命令：
 *   rest <关键词...>        REST 端点搜索（operationId/tags/path/summary/description）
 *   rest-id <operationId>   REST 端点详情（含参数）
 *   gql roots [scope]       枚举 GraphQL 根字段（query|mutation|all，默认 all）
 *   gql search <关键词>     搜索 GraphQL 根字段（名字/描述）
 *   gql type <TypeName>     递进：类型字段枚举（含参数/返回类型；▶ 标记 Connection）
 *   gql field <Type.field>  递进：字段详情（完整参数 + 返回类型）
 *   page <关键词>           页面分类搜索
 *   pageapi <关键词>        页面 → 关联 API 闭环
 *   stats                   索引统计（REST 操作 / GraphQL 类型 / 页面）
 *   update [--upgrade]      重跑全部生成器刷新索引 + debug 缓存 json（--upgrade 先升级 schema 包）
 *
 * 用法：`node scripts/apiidx.mjs <子命令> <参数...>`
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadSchema, typeStr } from "./gql-schema.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const DATA = join(root, "scripts", "data");
const REST_INDEX = join(DATA, "rest-index.json");
const PAGES_INDEX = join(DATA, "pages-index.json");
// debug 面板数据源（REST 三层产物 + GraphQL introspection 原数据）
const OUT_DIR = join(root, "web", "public", "debug");
const REST_DIR = join(OUT_DIR, "rest");
const GQL_DIR = join(OUT_DIR, "gql");

/* ── 数据加载 ── */

function load(file, label) {
  if (!existsSync(file)) {
    console.error(
      `[apiidx] 缺少数据文件 ${file}（${label}），请先运行 node scripts/${label} 或 apiidx update`,
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

/* ── 展示 ── */

/** 简单表格输出（对齐列宽） */
function table(rows) {
  if (!rows.length) return;
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] || "").length)));
  for (const r of rows) {
    console.log(
      r
        .map((cell, c) => (cell || "").padEnd(widths[c]))
        .join("  ")
        .trimEnd(),
    );
  }
}

/** 中文 2-gram 展开：连续中文片段按相邻两字滑窗切分 */
function expandChinese(text) {
  const out = [];
  const m = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of m) {
    if (seg.length === 1) out.push(seg);
    else for (let i = 0; i + 2 <= seg.length; i++) out.push(seg.slice(i, i + 2));
  }
  return out;
}

/** 查询分词：英文单词 + 中文 2-gram */
function tokenizeQuery(q) {
  const tokens = [];
  for (const part of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (/[\u4e00-\u9fff]/.test(part)) {
      for (const g of expandChinese(part)) tokens.push({ token: g, chinese: true });
    } else {
      tokens.push({ token: part, chinese: false });
    }
  }
  return tokens;
}

/** 匹配打分：OR 语义 + 命中 token 数排序（英文精确子串 / 中文 2-gram 子串） */
function scoreHit(hay, tokens) {
  let hit = 0;
  for (const { token, chinese } of tokens) {
    if (chinese) {
      if (expandChinese(hay).some((g) => g === token) || hay.includes(token)) hit++;
    } else if (hay.includes(token)) {
      hit++;
    }
  }
  return hit;
}

/* ── REST 子命令 ── */

function cmdRest(args) {
  const rest = load(REST_INDEX, "rest-index.mjs");
  const q = args.join(" ");
  const tokens = tokenizeQuery(q);
  const scored = rest.items
    .map((it) => {
      const hay = [it.id, (it.tags || []).join(" "), it.path, it.summary, it.description]
        .join(" ")
        .toLowerCase();
      return { it, score: scoreHit(hay, tokens) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    console.log(`[apiidx] 未找到匹配「${q}」的 REST 端点`);
    return;
  }
  console.log(`[apiidx] rest「${q}」→ ${scored.length} 条`);
  table([
    ["id", "method path", "tags", "summary"],
    ...scored
      .slice(0, 40)
      .map(({ it }) => [
        it.id,
        `${it.method} ${it.path}`.slice(0, 46),
        (it.tags || []).join(",").slice(0, 16),
        it.summary.slice(0, 48),
      ]),
  ]);
  if (scored.length > 40) console.log(`… 共 ${scored.length} 条，用 rest-id <id> 看详情`);
}

function cmdRestId(args) {
  const rest = load(REST_INDEX, "rest-index.mjs");
  const id = args[0];
  const it = rest.items.find((x) => x.id === id);
  if (!it) {
    console.log(`[apiidx] 未找到 REST operationId: ${id}（可用 rest <关键词> 搜索）`);
    return;
  }
  console.log(`id         : ${it.id}`);
  console.log(`endpoint   : ${it.method} ${it.path}`);
  console.log(`tags       : ${(it.tags || []).join(", ") || "—"}`);
  console.log(`summary    : ${it.summary || "—"}`);
  console.log(`desc       : ${it.description || "—"}`);
  if (it.parameters?.length) {
    console.log(`parameters :`);
    for (const p of it.parameters) {
      const req = p.required ? "必填" : "可选";
      console.log(`  ${p.name} (${p.in}, ${req}, ${p.type}) ${p.desc ? "— " + p.desc : ""}`);
    }
  }
}

/* ── GraphQL 子命令 ── */

/**
 * 官方 GraphQL 文档「主题 → 实际入口」映射（语义搜索补全，v0.0.1 工具基建）。
 *
 * 官方 docs.graphql 按主题组织（Actions/Teams/Orgs/... 共 33 类，见 docs.github.com/en/graphql/reference），
 * 但主题的实际 GraphQL 入口名**常与主题词不对应**（如 Actions 的入口是 Workflow/WorkflowRun 而非 "actions"，
 * Teams 的入口在 Organization.teams 而非根字段），`gql search` 只搜根字段名/描述，语义搜索搜不到这些
 * 「名字对不上」的入口。本表记录「主题/关键词 → 实际入口类型·字段 → 能力评估」，供 `gql topic` 查询
 * 与 `gql search` 无命中时的补全提示。gap 为空 = 入口清晰（已按 §0.2 四分类正常迁移/保留）。
 */
const GQL_TOPICS = [
  // —— 语义搜索搜不到、有修正价值（gap 非空）——
  {
    t: "Actions",
    kw: ["actions", "workflow", "ci", "github actions"],
    entry: "Workflow / WorkflowRun / WorkflowRunFile（经 CheckSuite.workflowRun 到达）",
    gap: "碎片节点：缺 Repository.workflows 列表入口、jobs/logs/artifacts、dispatch mutation → 维持 REST",
  },
  {
    t: "Teams",
    kw: ["teams", "team", "团队"],
    entry: "Organization.teams → Team.members / Team.repositories / Team.databaseId",
    gap: "读有写无：列表/成员可迁 GraphQL；createTeam/deleteTeam/updateTeam/addTeamMember/removeTeamMember 无 mutation → 写维持 REST",
  },
  {
    t: "Orgs",
    kw: ["org member", "member role", "成员", "角色", "2fa"],
    entry: "Organization.membersWithRole → OrganizationMemberEdge.role / hasTwoFactorEnabled",
    gap: "成员含角色/2FA 可迁 GraphQL（旧判断「无角色/2FA 字段」有误）",
  },
  {
    t: "Git",
    kw: ["git", "branch", "ref", "分支", "写文件", "commit", "创建分支"],
    entry: "createRef / updateRef / deleteRef / updateRefs / createCommitOnBranch",
    gap: "createRef=建分支；createCommitOnBranch=写文件（需 expectedHeadOid+FileChanges，比 REST contents 复杂）",
  },
  {
    t: "Activity",
    kw: ["notification", "通知", "feed", "动态"],
    entry: "—",
    gap: "Viewer.notifications 不存在 → 无 GraphQL，维持 REST",
  },
  {
    t: "Users",
    kw: ["gpg", "ssh key", "公钥", "gpg key"],
    entry: "—",
    gap: "Viewer 无 gpgKeys / GpgKey 类型不存在 → GPG/SSH 数字 id 无 GraphQL，维持 REST",
  },
  {
    t: "Security Advisories",
    kw: ["security advisory", "ghsa", "漏洞", "advisory"],
    entry: "SecurityAdvisory（ghsaId/databaseId/cvss/cwes/description）",
    gap: "类型存在但 Repository.securityAdvisories 入口不存在 → 入口不清晰，维持 REST（待查 node 入口）",
  },
  {
    t: "Checks",
    kw: ["check run", "check suite", "checks", "ci status"],
    entry: "CheckSuite / CheckRun（Commit.statusCheckRollup / CheckSuite.checkRuns）",
    gap: "",
  },
  // —— 入口清晰、已按四分类正确处置 ——
  {
    t: "Issues",
    kw: ["issue", "问题"],
    entry: "Issue / IssueComment（Repository.issues）",
    gap: "",
  },
  {
    t: "Pulls",
    kw: ["pull request", "pr"],
    entry: "PullRequest / PullRequestReview（Repository.pullRequests）",
    gap: "",
  },
  {
    t: "Discussions",
    kw: ["discussion"],
    entry: "Discussion / DiscussionComment（Repository.discussions）",
    gap: "",
  },
  { t: "Gists", kw: ["gist"], entry: "Gist / GistComment（Viewer.gists）", gap: "" },
  { t: "Releases", kw: ["release", "发布"], entry: "Release（Repository.releases）", gap: "" },
  {
    t: "Search",
    kw: ["search", "搜索"],
    entry: "search 根字段（type: ISSUE/REPOSITORY/USER/...）",
    gap: "",
  },
  {
    t: "Repos",
    kw: ["repository", "仓库"],
    entry: "Repository（repository/repositoryOwner）",
    gap: "",
  },
  { t: "Users", kw: ["user", "用户"], entry: "User（user(login:) / viewer）", gap: "" },
  {
    t: "Projects",
    kw: ["project", "项目"],
    entry: "ProjectV2（Repository.projectsV2 / organization.projectsV2）",
    gap: "",
  },
  {
    t: "Projects Classic",
    kw: ["project classic"],
    entry: "Project（已随 legacy Projects REST 下线）",
    gap: "",
  },
  { t: "Branches", kw: ["branches"], entry: "Ref（Repository.refs）", gap: "" },
  {
    t: "Commits",
    kw: ["commit", "提交"],
    entry: "Commit / Commit.history（Repository.object(expression:)）",
    gap: "",
  },
  {
    t: "Packages",
    kw: ["package", "包"],
    entry: "Package / PackageVersion（RegistryPackage*）",
    gap: "",
  },
  {
    t: "Dependabot",
    kw: ["dependabot"],
    entry: "DependabotAlert（Repository.dependabotAlerts）",
    gap: "",
  },
  { t: "Deploy Keys", kw: ["deploy key"], entry: "DeployKey（Repository.deployKeys）", gap: "" },
  {
    t: "Deployments",
    kw: ["deployment"],
    entry: "Deployment / DeploymentStatus（Repository.deployments）",
    gap: "",
  },
  {
    t: "Apps",
    kw: ["app", "github app"],
    entry: "App / Installation（Repository.owner → organization）",
    gap: "",
  },
  { t: "Reactions", kw: ["reaction", "表情"], entry: "Reaction（Reactable.reactions）", gap: "" },
  { t: "Licenses", kw: ["license", "许可证"], entry: "License（licenses 根字段）", gap: "" },
  { t: "Sponsors", kw: ["sponsor"], entry: "SponsorsListing（User.sponsorsListing）", gap: "" },
  {
    t: "Dependency Graph",
    kw: ["dependency graph"],
    entry: "DependencyGraphManifest（Repository.dependencyGraphManifests）",
    gap: "",
  },
  {
    t: "Meta",
    kw: ["rate limit", "配额", "meta"],
    entry: "rateLimit（根字段）/ REST /rate_limit（REST core 配额专属）",
    gap: "",
  },
  { t: "Migrations", kw: ["migration"], entry: "Migration 相关（企业迁移）", gap: "" },
  { t: "Enterprise Admin", kw: ["enterprise"], entry: "Enterprise 相关（企业管理员）", gap: "" },
  { t: "Other", kw: [], entry: "杂项（未归类的类型）", gap: "" },
];

/** 按关键词匹配主题映射（英文单词精确匹配防 "git" 误匹配 "github"；中文子串匹配） */
function matchTopics(q) {
  if (!q) return [];
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return GQL_TOPICS.filter((t) =>
    t.kw.some((k) => {
      const ktokens = k.split(/\s+/);
      return tokens.some((tok) => {
        if (/[\u4e00-\u9fff]/.test(tok)) {
          // 中文：子串匹配（关键词含 token，或 token 含关键词）
          return ktokens.some((kt) => kt.includes(tok) || tok.includes(kt));
        }
        // 英文：单词相等匹配
        return ktokens.some((kt) => kt === tok);
      });
    }),
  );
}

/** 打印主题映射补全提示（search 无命中时引导） */
function printTopicHints(q) {
  const hits = matchTopics(q);
  if (!hits.length) return;
  console.log(
    `\n[apiidx] 提示：官方 GraphQL 文档按主题组织，入口名常与主题词不对应，用 gql topic 查映射：`,
  );
  for (const t of hits.slice(0, 5)) {
    console.log(`  ${t.t} → ${t.entry}`);
    if (t.gap) console.log(`        ⚠ ${t.gap}`);
  }
}

/** 根字段（query/mutation）分组枚举 */
async function cmdGql(args) {
  const sub = args[0];
  if (!sub) return gqlUsage();
  const { __schema, source } = await loadSchema();
  console.log(
    `[apiidx] GraphQL schema 来源：${source === "remote" ? "官方实时" : source === "cache" ? "缓存(10min)" : "本地 @octokit/graphql-schema"}`,
  );

  const types = new Map(__schema.types.map((t) => [t.name, t]));
  const queryName = __schema.queryType?.name;
  const mutationName = __schema.mutationType?.name;
  const rootOf = (name) =>
    name === queryName ? "query" : name === mutationName ? "mutation" : null;

  if (sub === "roots") {
    const scope = args[1] || "all";
    const groups = [];
    if (scope === "all" || scope === "query") {
      groups.push([`Query 根字段（${queryName}）`, types.get(queryName)]);
    }
    if (scope === "all" || scope === "mutation") {
      groups.push([`Mutation 根字段（${mutationName}）`, types.get(mutationName)]);
    }
    for (const [label, t] of groups) {
      if (!t) continue;
      console.log(`\n${label}：`);
      table(
        t.fields.map((f) => [
          f.name + (f.args?.length ? `(${f.args.map((a) => a.name).join(", ")})` : ""),
          typeStr(f.type),
          (f.description || "").split("\n")[0].slice(0, 56),
        ]),
      );
    }
    return;
  }

  if (sub === "search") {
    const q = args.slice(1).join(" ");
    const tokens = tokenizeQuery(q);
    const allFields = [];
    for (const name of [queryName, mutationName]) {
      const t = types.get(name);
      for (const f of t?.fields || []) allFields.push({ f, kind: rootOf(name) });
    }
    const scored = allFields
      .map(({ f, kind }) => {
        const hay = `${f.name} ${f.description || ""}`.toLowerCase();
        return { f, kind, score: scoreHit(hay, tokens) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) {
      console.log(`[apiidx] 未找到匹配「${q}」的 GraphQL 根字段`);
      printTopicHints(q);
      return;
    }
    console.log(`[apiidx] gql 根字段「${q}」→ ${scored.length} 条`);
    table([
      ["kind", "field", "type", "desc"],
      ...scored.map(({ f, kind }) => [
        kind,
        f.name + (f.args?.length ? `(${f.args.map((a) => a.name).join(", ")})` : ""),
        typeStr(f.type),
        (f.description || "").split("\n")[0].slice(0, 48),
      ]),
    ]);
    return;
  }

  if (sub === "topic") {
    const q = args.slice(1).join(" ").toLowerCase();
    const hits = matchTopics(q);
    if (!hits.length) {
      console.log(`[apiidx] 未找到匹配「${args.slice(1).join(" ")}」的官方主题（GQL_TOPICS 映射）`);
      console.log(`  可用主题：${GQL_TOPICS.map((t) => t.t).join(" / ")}`);
      return;
    }
    console.log(`[apiidx] 官方 GraphQL 主题映射「${q}」→ ${hits.length} 条`);
    for (const t of hits) {
      console.log(`\n${t.t}`);
      console.log(`  入口 : ${t.entry}`);
      if (t.gap) console.log(`  缺口 : ${t.gap}`);
      if (t.kw.length) console.log(`  关键词 : ${t.kw.join(" / ")}`);
    }
    return;
  }

  if (sub === "type") {
    const name = args[1];
    const t = types.get(name) || types.get(name?.toLowerCase());
    if (!t) {
      // 模糊匹配类型名（大小写不敏感包含）
      const hits = __schema.types.filter((x) => x.name.toLowerCase().includes(name?.toLowerCase()));
      if (hits.length) {
        console.log(`[apiidx] 未精确匹配类型「${name}」，相近类型：`);
        console.log(
          hits
            .slice(0, 20)
            .map((x) => `  ${x.name} (${x.kind})`)
            .join("\n"),
        );
      } else {
        console.log(`[apiidx] 未找到 GraphQL 类型: ${name}`);
        printTopicHints(name);
      }
      return;
    }
    const isConn = t.name.endsWith("Connection");
    console.log(
      `\n类型 ${t.name}（${t.kind}${isConn ? " · ▶Connection" : ""}）${
        t.description ? " — " + t.description.split("\n")[0] : ""
      }`,
    );
    if (t.kind === "ENUM") {
      console.log(`枚举值：${(t.enumValues || []).map((e) => e.name).join(", ")}`);
      return;
    }
    if (t.kind === "INPUT_OBJECT") {
      console.log(`输入字段：`);
      for (const f of t.inputFields || []) {
        console.log(
          `  ${f.name}: ${typeStr(f.type)}${f.description ? " — " + f.description.split("\n")[0] : ""}`,
        );
      }
      return;
    }
    if (t.kind === "SCALAR") return;
    if (!t.fields?.length) {
      console.log(`（无字段；可能为 union/interface，用 gql type 查看 possibleTypes）`);
      if (t.possibleTypes?.length) {
        console.log(`possibleTypes：${t.possibleTypes.map((p) => p.name).join(", ")}`);
      }
      return;
    }
    console.log(`字段（${t.fields.length} 个）：`);
    table(
      t.fields.map((f) => [
        f.name + (f.args?.length ? `(${f.args.map((a) => a.name).join(", ")})` : ""),
        typeStr(f.type),
        (f.description || "").split("\n")[0].slice(0, 56),
      ]),
    );
    return;
  }

  if (sub === "field") {
    const ref = args[1];
    const dot = ref?.indexOf(".");
    if (!ref || dot <= 0) {
      console.log(`[apiidx] 用法：apiidx gql field <Type.field>（如 Repository.refs）`);
      return;
    }
    const typeName = ref.slice(0, dot);
    const fieldName = ref.slice(dot + 1);
    const t = types.get(typeName) || types.get(typeName.toLowerCase());
    const f = t?.fields?.find((x) => x.name === fieldName);
    if (!f) {
      console.log(`[apiidx] 未找到字段 ${ref}（先 gql type ${typeName} 枚举确认字段名）`);
      return;
    }
    console.log(`字段      : ${typeName}.${fieldName}`);
    console.log(`返回类型  : ${typeStr(f.type)}`);
    if (f.description) console.log(`描述      : ${f.description.split("\n")[0]}`);
    if (f.isDeprecated) console.log(`废弃      : ${f.deprecationReason || "是"}`);
    if (f.args?.length) {
      console.log(`参数      :`);
      for (const a of f.args) {
        console.log(
          `  ${a.name}: ${typeStr(a.type)} ${a.description ? "— " + a.description.split("\n")[0] : ""}`,
        );
      }
    } else {
      console.log(`参数      : 无`);
    }
    return;
  }

  gqlUsage();
}

function gqlUsage() {
  console.log(`用法:
  node scripts/apiidx.mjs gql roots [query|mutation|all]  枚举根字段
  node scripts/apiidx.mjs gql search <关键词>             搜索根字段（无命中提示主题映射）
  node scripts/apiidx.mjs gql topic <关键词>              官方主题 → 实际入口映射（语义搜索补全）
  node scripts/apiidx.mjs gql type <TypeName>             递进：类型字段枚举
  node scripts/apiidx.mjs gql field <Type.field>          递进：字段详情`);
}

/* ── 页面子命令 ── */

function cmdPage(args) {
  const pages = load(PAGES_INDEX, "page-index.mjs");
  const q = args.join(" ");
  const tokens = tokenizeQuery(q);
  const scored = pages.items
    .map((p) => {
      const hay = [
        p.route,
        p.id,
        (p.keywords || []).join(" "),
        p.module,
        p.framework,
        (p.apiIds || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return { p, score: scoreHit(hay, tokens) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) {
    console.log(`[apiidx] 未找到匹配「${q}」的页面`);
    return;
  }
  console.log(`[apiidx] page「${q}」→ ${scored.length} 条`);
  table([
    ["route", "module", "status", "apiIds"],
    ...scored
      .slice(0, 30)
      .map(({ p }) => [
        p.route,
        p.module.slice(0, 40),
        p.status,
        (p.apiIds || []).join(",").slice(0, 56),
      ]),
  ]);
}

function cmdPageApi(args) {
  const rest = load(REST_INDEX, "rest-index.mjs");
  const pages = load(PAGES_INDEX, "page-index.mjs");
  const q = args.join(" ").toLowerCase();
  const page = pages.items.find(
    (p) =>
      p.route.toLowerCase().includes(q) || (p.keywords || []).join(" ").toLowerCase().includes(q),
  );
  if (!page) {
    console.log(`[apiidx] 未找到匹配「${q}」的页面`);
    return;
  }
  console.log(`页面: ${page.route} — ${page.module}`);
  console.log(`框架: ${page.framework || "—"}`);
  console.log(`状态: ${page.status}`);
  console.log(`关联 API（${(page.apiIds || []).length} 个）:`);
  for (const id of page.apiIds || []) {
    if (id === "*") {
      console.log(`  *  （全部端点，通配）`);
      continue;
    }
    const it = rest.items.find((x) => x.id === id);
    if (it) {
      console.log(`  ${it.id}  ${it.method} ${it.path}`);
    } else {
      console.log(
        `  ${id}  （gql: 前缀为 GraphQL 根字段，用 gql field 查；其余可能已改名，用 rest <关键词> 复核）`,
      );
    }
  }
}

/* ── stats / update ── */

async function cmdStats() {
  const rest = load(REST_INDEX, "rest-index.mjs");
  const pages = load(PAGES_INDEX, "page-index.mjs");
  const { __schema, source } = await loadSchema();
  const types = new Map(__schema.types.map((t) => [t.name, t]));
  const queryName = __schema.queryType?.name;
  const mutationName = __schema.mutationType?.name;
  console.log(`API 索引（${rest.meta.generatedAt} · ${rest.meta.version}）`);
  console.log(`  REST 操作：${rest.meta.counts.operations}`);
  console.log(`GraphQL schema（来源：${source === "local" ? "本地" : "官方"}）`);
  console.log(
    `  类型 ${__schema.types.length} 个；Query 根字段 ${types.get(queryName)?.fields.length ?? 0}；Mutation 根字段 ${types.get(mutationName)?.fields.length ?? 0}`,
  );
  console.log(`页面分类索引（${pages.meta.generatedAt}）`);
  const c = pages.meta.counts;
  console.log(`  共 ${c.pages} 页：done ${c.done} / partial ${c.partial} / todo ${c.todo}`);
}

function cmdUpdate(args) {
  const upgrade = args.includes("--upgrade");
  if (upgrade) {
    console.log("[apiidx] 升级 schema 数据源包（@octokit/openapi + @octokit/graphql-schema）…");
    execSync("pnpm up @octokit/openapi @octokit/graphql-schema", { cwd: root, stdio: "inherit" });
  }
  console.log("[apiidx] 重新生成索引（rest-index + page-index）…");
  execSync("node scripts/rest-index.mjs", { cwd: root, stdio: "inherit" });
  execSync("node scripts/page-index.mjs", { cwd: root, stdio: "inherit" });
  console.log("[apiidx] 转录 debug 缓存 json（web/public/debug/）…");
  transcribeDebugAssets();
}

/* ── debug 缓存 json 转录（原 update-schemas.mjs，已合并进 apiidx update）──
 * 从已安装的 octokit 包零下载转录两种 schema，供前端 /$debug 面板消费：
 * - REST：@octokit/openapi（deref）→ 按 tag 拆 req / res-min / res-full 三层 + index.json
 * - GraphQL：@octokit/graphql-schema → 完整 introspection 原数据 schema.json + index.json
 */

/** 精简 parameter：name/in/required/schema 类型 + 短 desc */
function compactParam(p) {
  const out = { name: p.name, in: p.in };
  if (p.required) out.required = true;
  if (p.schema?.type) out.type = p.schema.type;
  else if (p.schema?.$ref) out.type = p.schema.$ref.split("/").pop();
  if (typeof p.description === "string" && p.description.length <= 150) out.desc = p.description;
  return out;
}

/** 请求部分：operation 元数据 + 参数 + requestBody（body schema 全量保留） */
function buildReq(op) {
  const out = {};
  if (op.operationId) out.id = op.operationId;
  if (op.summary) out.summary = op.summary;
  if (op.description && op.description.length <= 400) out.desc = op.description;
  if (Array.isArray(op.tags) && op.tags.length) out.tags = op.tags;
  if (Array.isArray(op.parameters) && op.parameters.length)
    out.params = op.parameters.map(compactParam);
  if (op.requestBody?.content) {
    out.bodyTypes = Object.keys(op.requestBody.content);
    out.body = Object.fromEntries(
      Object.entries(op.requestBody.content).map(([ct, c]) => [ct, c.schema || null]),
    );
  }
  return out;
}

/** 响应状态码精简：只留 {status, desc} */
function buildResMin(op) {
  if (!op.responses) return null;
  return Object.entries(op.responses)
    .map(([s, r]) => ({
      s,
      desc: typeof r?.description === "string" ? r.description.slice(0, 120) : "",
    }))
    .sort((a, b) => a.s.localeCompare(b.s, undefined, { numeric: true }));
}

/** 响应完整：responses 原样 */
function buildResFull(op) {
  return op.responses || null;
}

/** 按 tag 分组收集（fn 返回 null 则跳过） */
function groupByTag(doc, fn) {
  const map = new Map();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(methods)) {
      if (!["get", "post", "patch", "put", "delete", "head"].includes(m)) continue;
      if (!op || typeof op !== "object") continue;
      const tag = (op.tags && op.tags[0]) || path.split("/").filter(Boolean)[0] || "misc";
      const v = fn(op);
      if (v == null) continue;
      const list = map.get(tag) ?? [];
      list.push({ method: m, path, v });
      map.set(tag, list);
    }
  }
  return map;
}

/** 输出 { tag: { method: {path: v} } } → 目录文件 */
function writeTagFiles(map, dir, ext) {
  for (const [tag, items] of map) {
    const obj = { tag, paths: {} };
    for (const { method, path, v } of items) {
      obj.paths[path] = obj.paths[path] ?? {};
      obj.paths[path][method] = v;
    }
    writeFileSync(join(dir, `${tag}.${ext}.json`), JSON.stringify(obj));
  }
}

/** REST 三层产物转录 */
function transcribeRest() {
  const { schemas } = require("../node_modules/@octokit/openapi/index.js");
  const doc = schemas["api.github.com.deref"];
  if (!doc?.paths) throw new Error("@octokit/openapi 未提供 api.github.com.deref schema");

  const reqMap = groupByTag(doc, buildReq);
  const resMinMap = groupByTag(doc, buildResMin);
  const resFullMap = groupByTag(doc, buildResFull);
  const tags = [...new Set([...reqMap.keys(), ...resMinMap.keys(), ...resFullMap.keys()])].sort();

  writeTagFiles(reqMap, REST_DIR, "req");
  writeTagFiles(resMinMap, REST_DIR, "res-min");
  writeTagFiles(resFullMap, REST_DIR, "res-full");

  const tagInfo = tags.map((tag) => {
    const size = (f) => {
      const p = join(REST_DIR, `${tag}.${f}.json`);
      return existsSync(p) ? Math.max(1, Math.round(statSync(p).size / 1024)) : 0;
    };
    return {
      tag,
      ops: reqMap.get(tag)?.length ?? 0,
      reqKB: size("req"),
      resMinKB: size("res-min"),
      resFullKB: size("res-full"),
    };
  });
  const version = require("../node_modules/@octokit/openapi/package.json").version;
  writeFileSync(
    join(REST_DIR, "index.json"),
    JSON.stringify({ version: `openapi@${version}`, tags: tagInfo }),
  );
  const totalOps = tagInfo.reduce((a, t) => a + t.ops, 0);
  console.log(
    `[REST] 转录 ${tags.length} tag / ${totalOps} 操作 → web/public/debug/rest/（req/res-min/res-full 三层）`,
  );
}

/** GraphQL introspection 原数据转录 */
function transcribeGql() {
  const mod = require("../node_modules/@octokit/graphql-schema/index.js");
  writeFileSync(join(GQL_DIR, "schema.json"), JSON.stringify(mod.schema.json));
  const gqlVersion = require("../node_modules/@octokit/graphql-schema/package.json").version;
  writeFileSync(
    join(GQL_DIR, "index.json"),
    JSON.stringify({ version: `graphql-schema@${gqlVersion}` }),
  );
  const raw = Buffer.byteLength(JSON.stringify(mod.schema.json));
  const gz = require("node:zlib").gzipSync(Buffer.from(JSON.stringify(mod.schema.json))).length;
  console.log(
    `[GraphQL] 转录 ${mod.schema.json.__schema.types.length} 类型（原数据含 description）→ web/public/debug/gql/schema.json（${(raw / 1024).toFixed(0)}KB raw / ${(gz / 1024).toFixed(0)}KB gzip）`,
  );
}

/** debug 缓存 json 全量刷新（清空旧产物再转录，避免残留冗余文件） */
function transcribeDebugAssets() {
  rmSync(REST_DIR, { recursive: true, force: true });
  rmSync(GQL_DIR, { recursive: true, force: true });
  mkdirSync(REST_DIR, { recursive: true });
  mkdirSync(GQL_DIR, { recursive: true });
  transcribeRest();
  transcribeGql();
  console.log("完成：octokit 转录 → web/public/debug/（零下载）");
}

function cmdUsage() {
  console.log(`用法:
  node scripts/apiidx.mjs rest <关键词...>        搜索 REST 端点
  node scripts/apiidx.mjs rest-id <operationId>   REST 端点详情（含参数）
  node scripts/apiidx.mjs gql roots [scope]       枚举 GraphQL 根字段（query|mutation|all）
  node scripts/apiidx.mjs gql search <关键词>     搜索 GraphQL 根字段（无命中提示主题映射）
  node scripts/apiidx.mjs gql topic <关键词>      官方主题 → 实际入口映射（语义搜索补全）
  node scripts/apiidx.mjs gql type <TypeName>     递进：类型字段枚举
  node scripts/apiidx.mjs gql field <Type.field>  递进：字段详情
  node scripts/apiidx.mjs page <关键词>           搜索页面分类
  node scripts/apiidx.mjs pageapi <关键词>        页面 → 关联 API 闭环
  node scripts/apiidx.mjs stats                   索引统计
  node scripts/apiidx.mjs update [--upgrade]      重跑生成器刷新索引 + debug 缓存 json（--upgrade 先升级 schema 包）`);
}

/* ── 入口 ── */

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "rest":
    cmdRest(args);
    break;
  case "rest-id":
    cmdRestId(args);
    break;
  case "gql":
    await cmdGql(args);
    break;
  case "page":
    cmdPage(args);
    break;
  case "pageapi":
    cmdPageApi(args);
    break;
  case "stats":
    await cmdStats();
    break;
  case "update":
    cmdUpdate(args);
    break;
  default:
    cmdUsage();
}
