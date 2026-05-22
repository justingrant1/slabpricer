import LoginForm from "./LoginForm";

export const metadata = { title: "Login · Slab Pricer" };

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="card w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">🪙 Slab Pricer</h1>
        <p className="text-sm text-muted mb-4">Enter the access password to continue.</p>
        <LoginForm next={searchParams.next ?? "/"} error={searchParams.error} />
      </div>
    </div>
  );
}
