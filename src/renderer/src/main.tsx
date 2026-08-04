import { installIconCollection } from "./iconSetup";
import { installChartComponents } from "./chartSetup";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installTauriBridgeApi, verifySparklyRuntime } from "./tauriBridge";
import "./styles.css";

installIconCollection();
installChartComponents();

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (await verifySparklyRuntime()) {
  installTauriBridgeApi();
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else {
  document.title = "Sparkly API - Native runtime required";
  root.render(
    <main className="runtime-mismatch-screen">
      <section>
        <h1>Sparkly API did not start in its native shell</h1>
        <p>This renderer refuses to run in a browser, another desktop application, or a mismatched development WebView. Close this window and start Sparkly API again.</p>
      </section>
    </main>,
  );
}
