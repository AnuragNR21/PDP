import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import CssBaseline from "@mui/material/CssBaseline";
import { router } from "@/app/router";
import { AppQueryProvider } from "@/app/providers/AppQueryProvider";
import { AppThemeProvider } from "@/app/providers/AppThemeProvider";
import { GlobalContextProvider } from "@/app/providers/GlobalContextProvider";
import { ToastProvider } from "@/shared/toast/ToastContext";
import { ForbiddenNotice } from "@/shared/http/ForbiddenNotice";
import { AuthProvider } from "@/features/auth/state/AuthContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppThemeProvider>
      <CssBaseline />
      <ToastProvider>
        <ForbiddenNotice />
        <AppQueryProvider>
          <AuthProvider>
            <GlobalContextProvider>
              <RouterProvider router={router} />
            </GlobalContextProvider>
          </AuthProvider>
        </AppQueryProvider>
      </ToastProvider>
    </AppThemeProvider>
  </React.StrictMode>
);
