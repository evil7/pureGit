/**
 * GitHub Actions workflow 模板数据层（官方 /actions/new 模板选择页数据源）
 *
 * 数据源：GitHub 官方公共仓库 actions/starter-workflows（官方 /actions/new 页面的模板来源）。
 * 目录结构：分类目录（ci/automation/deployments/code-scanning/pages）→ 每目录下
 *   - {name}.yml                       模板正文
 *   - properties/{name}.properties.json 元数据（name/description/creator/iconName）
 *   - icons/{iconName}.svg              图标（根目录 icons/）
 *
 * 通道策略（对齐架构红线）：
 * - 目录列举复用 fetchDirContentsSmart（登录 GraphQL 主通道 + REST 熔断）
 * - 内容（元数据/正文/图标）复用 fetchFileContentSmart（登录 REST→$raw 保底；
 *   匿名 jsDelivr@sha 绕墙 → REST → raw 直连 → $raw）——公开数据无需自建 raw/contents 通道。
 */
import { fetchDirContentsSmart, fetchFileContentSmart } from "./api-file";
import type { DirEntry } from "../restapi";

/** 官方模板仓库（actions/starter-workflows） */
const TEMPLATES_OWNER = "actions";
const TEMPLATES_REPO = "starter-workflows";
const TEMPLATES_REF = "main";

/** 分类目录 → 官方显示名（官方 /actions/new 分类标题） */
const CATEGORY_NAMES: Record<string, string> = {
  ci: "Continuous integration",
  automation: "Automation",
  deployments: "Deployment",
  "code-scanning": "Security",
  pages: "Pages",
};

/** workflow 模板（官方卡片数据） */
export interface WorkflowTemplate {
  /** workflow_template 值：`{category}/{name}`（如 "ci/blank"） */
  template: string;
  /** 目标文件名（如 "blank.yml"，官方 filename query 用 .github/workflows/{filename}） */
  filename: string;
  /** 卡片标题（properties.json name，如 "Simple workflow"） */
  name: string;
  /** 卡片描述（properties.json description） */
  description: string;
  /** 作者（properties.json creator，如 "GitHub"） */
  creator: string;
  /** 图标名（properties.json iconName，如 "blank"） */
  iconName: string;
  /** 分类目录（如 "ci"） */
  category: string;
}

/** 模板分类 */
export interface WorkflowCategory {
  id: string;
  name: string;
}

/** 分类目录 → 官方显示名（未知目录回退原始 id） */
export function workflowCategoryName(id: string): string {
  return CATEGORY_NAMES[id] ?? id;
}

/** 模板元数据（properties.json） */
interface TemplateMeta {
  name?: string;
  description?: string;
  creator?: string;
  iconName?: string;
}

/** 拉分类目录列表（按 CATEGORY_NAMES 白名单过滤根目录下的分类目录） */
export async function fetchWorkflowCategories(token?: string | null): Promise<WorkflowCategory[]> {
  const entries = await fetchDirContentsSmart(
    TEMPLATES_OWNER,
    TEMPLATES_REPO,
    "",
    TEMPLATES_REF,
    token,
  );
  return entries
    .filter((e) => e.type === "dir" && CATEGORY_NAMES[e.name])
    .map((e) => ({ id: e.name, name: CATEGORY_NAMES[e.name] }));
}

/** 拉某分类下的模板列表（.yml 文件名 + 元数据；元数据缺失时回退文件名） */
export async function fetchWorkflowTemplates(
  category: string,
  token?: string | null,
): Promise<WorkflowTemplate[]> {
  const entries = await fetchDirContentsSmart(
    TEMPLATES_OWNER,
    TEMPLATES_REPO,
    category,
    TEMPLATES_REF,
    token,
  );
  const ymls = entries.filter((e: DirEntry) => e.type === "file" && e.name.endsWith(".yml"));
  return Promise.all(
    ymls.map(async (yml) => {
      const name = yml.name.replace(/\.yml$/, "");
      const meta = await fetchTemplateMeta(category, name, token);
      return {
        template: `${category}/${name}`,
        filename: `${name}.yml`,
        name: meta?.name ?? name,
        description: meta?.description ?? "",
        creator: meta?.creator ?? "",
        iconName: meta?.iconName ?? "",
        category,
      };
    }),
  );
}

/** 拉模板元数据 properties.json（复用 fetchFileContentSmart 智能通道；失败返回 null） */
async function fetchTemplateMeta(
  category: string,
  name: string,
  token?: string | null,
): Promise<TemplateMeta | null> {
  const text = await readTemplateFile(`${category}/properties/${name}.properties.json`, token);
  if (!text) return null;
  try {
    return JSON.parse(text) as TemplateMeta;
  } catch {
    return null;
  }
}

/** 拉模板正文 YAML（复用 fetchFileContentSmart；供新建文件页预填正文） */
export async function fetchTemplateContent(
  category: string,
  name: string,
  token?: string | null,
): Promise<string | null> {
  return readTemplateFile(`${category}/${name}.yml`, token);
}

/** 拉模板图标 → data URI（复用 fetchFileContentSmart 读 SVG 文本 → data URI；失败返回 null） */
export async function fetchTemplateIconDataUri(
  iconName: string,
  token?: string | null,
): Promise<string | null> {
  // octicon 引用（如 "octicon smiley"）非自定义 SVG 文件（icons/ 目录无对应文件），
  // 直接跳过——避免对不存在的文件发起请求，触发降级链底部的 $raw 401 噪音。
  if (!/^[\w-]+$/.test(iconName)) return null;
  const text = await readTemplateFile(`icons/${iconName}.svg`, token);
  return text ? `data:image/svg+xml,${encodeURIComponent(text)}` : null;
}

/** 读模板仓库单文件文本（fetchFileContentSmart 包一层 try/catch → null 语义） */
async function readTemplateFile(path: string, token?: string | null): Promise<string | null> {
  try {
    return await fetchFileContentSmart(TEMPLATES_OWNER, TEMPLATES_REPO, path, token, TEMPLATES_REF);
  } catch {
    return null;
  }
}
