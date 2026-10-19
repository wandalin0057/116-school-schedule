import type { MetadataRoute } from "next";

/** 讓網站可在 Chrome／Edge「安裝」成電腦上的應用程式（桌面圖示、獨立視窗） */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "通學區案件期程暨發文管理系統",
    short_name: "通學區案件",
    description: "通學區規劃案件期程、工作待辦、公文與 Email 草稿管理",
    lang: "zh-Hant-TW",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7fa",
    theme_color: "#1e3a6e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "儀表板", url: "/" },
      { name: "工作待辦", url: "/tasks" },
      { name: "學校案件", url: "/cases" },
    ],
  };
}
