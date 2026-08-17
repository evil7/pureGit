/**
 * 常用请求头预设（请求头表格添加按钮旁的可选快捷项）
 *
 * 用户在请求头列表手动添加常见 header 时，直接点预设 badge 即可补行（key 预填），
 * 无需手敲；部分 header 值有固定枚举（如 Accept / Content-Type / X-GitHub-Api-Version），
 * 值输入框用「Input + datalist」下拉提示（可选也可自定义）。
 *
 * 结构：{ key, values?: string[] }——values 为空数组 = 该头值自由输入（无枚举）；
 * values 非空 = 常见取值（datalist 建议项，仍可手写任意值）。
 */
export interface HeaderPreset {
  /** 请求头名（标准写法） */
  key: string;
  /** 常见取值（datalist 下拉建议；空 = 无枚举自由输入） */
  values?: string[];
}

/** GitHub API 常用请求头预设（点击 badge 快速添加行） */
export const COMMON_HEADER_PRESETS: HeaderPreset[] = [
  { key: "Accept", values: ["application/vnd.github+json", "application/json", "text/plain"] },
  {
    key: "Content-Type",
    values: [
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
      "text/plain",
    ],
  },
  { key: "X-GitHub-Api-Version", values: ["2022-11-28"] },
  { key: "User-Agent", values: [] },
  { key: "If-None-Match", values: [] },
  { key: "If-Modified-Since", values: [] },
  { key: "X-GitHub-Next-Global-ID", values: ["1"] },
];
