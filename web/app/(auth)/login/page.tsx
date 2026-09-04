import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginView } from "@/components/auth/login-view";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  // useSearchParams (for the ?next= redirect) needs a Suspense boundary, or it
  // opts the whole route out of static rendering.
  return (
    <Suspense fallback={<div className="min-h-screen bg-plane" />}>
      <LoginView />
    </Suspense>
  );
}
