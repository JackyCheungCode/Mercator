import React from "react";
import ReactDOM from "react-dom/client";
import { Theme } from "@carbon/react";
import App from "./App";
import "@carbon/styles/css/styles.css";
import "./styles.scss";
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Theme theme="g100"><App /></Theme></React.StrictMode>);