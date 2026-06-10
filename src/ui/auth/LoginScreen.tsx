import React, { useState } from "react";
import { Auth } from "@/auth/LoginPage.tsx";

interface LoginScreenProps {
  authLoading: boolean;
  onAuthSuccess: (authData: {
    isAdmin: boolean;
    username: string | null;
    userId: string | null;
  }) => void;
}

export function LoginScreen({
  authLoading,
  onAuthSuccess,
}: LoginScreenProps): React.ReactElement {
  const [loggedIn, setLoggedIn] = useState(false);
  const [, setIsAdmin] = useState(false);
  const [, setUsername] = useState<string | null>(null);
  const [, setUserId] = useState<string | null>(null);
  const [, setDbError] = useState<string | null>(null);

  return (
    <div className="w-full h-full flex items-center justify-center">
      <Auth
        setLoggedIn={setLoggedIn}
        setIsAdmin={setIsAdmin}
        setUsername={setUsername}
        setUserId={setUserId}
        loggedIn={loggedIn}
        authLoading={authLoading}
        setDbError={setDbError}
        onAuthSuccess={onAuthSuccess}
      />
    </div>
  );
}
