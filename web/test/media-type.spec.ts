import { describe, it, expect } from "vitest";
import { getMediaKind } from "@/lib/repo/media-type";

describe("getMediaKind（媒体类型识别）", () => {
  it("图片扩展名 → image（大小写不敏感）", () => {
    expect(getMediaKind("docs/screenshots/fileview.png")).toBe("image");
    expect(getMediaKind("a/b/c.JPG")).toBe("image");
    expect(getMediaKind("logo.webp")).toBe("image");
    expect(getMediaKind("favicon.ico")).toBe("image");
    expect(getMediaKind("photo.avif")).toBe("image");
    expect(getMediaKind("diagram.gif")).toBe("image");
  });

  it("音频扩展名 → audio", () => {
    expect(getMediaKind("sounds/theme.mp3")).toBe("audio");
    expect(getMediaKind("x.wav")).toBe("audio");
    expect(getMediaKind("a.flac")).toBe("audio");
    expect(getMediaKind("b.ogg")).toBe("audio");
    expect(getMediaKind("c.m4a")).toBe("audio");
  });

  it("视频扩展名 → video", () => {
    expect(getMediaKind("videos/demo.mp4")).toBe("video");
    expect(getMediaKind("x.webm")).toBe("video");
    expect(getMediaKind("y.ogv")).toBe("video");
    expect(getMediaKind("z.mov")).toBe("video");
    expect(getMediaKind("w.mkv")).toBe("video");
  });

  it("SVG → null（走代码渲染确保安全，不内联渲染）", () => {
    expect(getMediaKind("icons/logo.svg")).toBeNull();
    expect(getMediaKind("a.SVG")).toBeNull();
  });

  it("文本/代码/未知扩展名 → null", () => {
    expect(getMediaKind("src/index.ts")).toBeNull();
    expect(getMediaKind("README.md")).toBeNull();
    expect(getMediaKind("package.json")).toBeNull();
    expect(getMediaKind("Makefile")).toBeNull();
    expect(getMediaKind("a.unknown")).toBeNull();
  });

  it("无扩展名 → null", () => {
    expect(getMediaKind("LICENSE")).toBeNull();
    expect(getMediaKind("a/b/c")).toBeNull();
  });
});
