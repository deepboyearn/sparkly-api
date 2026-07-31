import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installBrowserBridgeApi } from "./browserBridgeApi";
import "./styles.css";

installBrowserBridgeApi();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
