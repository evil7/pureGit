/**
 * 媒体类型识别（纯函数，供 BlobPage 与测试复用）
 *
 * 按文件扩展名判断 blob 文件是否为可内联渲染的媒体（图片/音频/视频），
 * 供 BlobPage 用 <img>/<audio>/<video> 直接渲染（src 走 /$raw 统一入口）。
 *
 * 安全边界：SVG 刻意**不**归入 image——SVG 可内联脚本/事件处理器，作为 <img>
 * 直接渲染有 XSS 风险（虽 <img src> 不执行脚本，但历史漏洞与语义混乱多发），
 * 故 SVG 走代码渲染（CodeView 以 xml 语法高亮只读展示），确保安全。
 */

export type MediaKind = "image" | "audio" | "video";

/** 可内联渲染的位图/静态图片扩展名（**排除 svg**，svg 走代码渲染确保安全） */
const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "ico",
  "bmp",
  "avif",
  "apng",
  "tif",
  "tiff",
]);

/** 可内联播放的音频扩展名 */
const AUDIO_EXTS = new Set([
  "mp3",
  "wav",
  "ogg",
  "oga",
  "flac",
  "m4a",
  "aac",
  "opus",
  "weba",
  "mid",
  "midi",
]);

/** 可内联播放的视频扩展名 */
const VIDEO_EXTS = new Set([
  "mp4",
  "webm",
  "ogv",
  "mov",
  "m4v",
  "mkv",
  "avi",
  "mpg",
  "mpeg",
  "3gp",
]);

/**
 * 判断文件路径是否为可内联渲染的媒体 → "image" / "audio" / "video"，否则 null。
 * 扩展名大小写不敏感；无扩展名 / 未知扩展名 → null（走代码渲染）。
 */
export function getMediaKind(path: string): MediaKind | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1 || dot === path.length - 1) return null;
  const ext = path.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return null;
}
