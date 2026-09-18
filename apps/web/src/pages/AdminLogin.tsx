import LoginForm from '../components/LoginForm';

export default function AdminLogin() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="card space-y-4">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="Syjon Event" className="h-9 w-9" />
          <h1 className="text-xl font-semibold">Logowanie do panelu</h1>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
