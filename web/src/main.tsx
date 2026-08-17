import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./custom.css"; // 项目自定义样式（非 shadcn 脚手架，独立保存防被重置覆盖）
import App from "./App.tsx";
import { AuthProvider } from "./hooks/useAuth.tsx";
import "./i18n"; // 初始化 react-i18next（默认实例全局可用）

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
