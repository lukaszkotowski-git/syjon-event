import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Ban, Crown, Ellipsis, KeyRound, LoaderCircle, RotateCcw, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { hasFullAccess, type AdminUserDto, type AssignableAdminRole } from '@syjonevent/shared';
import { useConfirm } from '../components/ui/ConfirmDialog';
import Menu from '../components/ui/Menu';
import { useToast } from '../components/ui/Toast';
import { useAdmin } from '../lib/admin';
import { api, ApiError, formatDateTime } from '../lib/api';

const ROLE_OPTIONS: { value: AssignableAdminRole; label: string; description: string }[] = [
  { value: 'ADMIN', label: 'Administrator', description: 'Pełny dostęp: wydarzenia, zgłoszenia, wiadomości, zespół.' },
  { value: 'VIEWER', label: 'Tylko podgląd', description: 'Widzi wydarzenia, zgłoszenia i raporty, ale niczego nie zmienia.' },
];

const roleLabel = (role: AssignableAdminRole) => ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;

/** Losowe hasło startowe — admin przekazuje je osobie, która może je potem zmienić przez administratora. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export default function AdminTeam() {
  const me = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const [admins, setAdmins] = useState<AdminUserDto[] | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(generatePassword);
  const [role, setRole] = useState<AssignableAdminRole>('VIEWER');
  const [busy, setBusy] = useState(false);
  const [ownPassword, setOwnPassword] = useState<{ current: string; next: string; repeat: string } | null>(null);

  useEffect(() => {
    if (!hasFullAccess(me.role)) return;
    api
      .get<{ admins: AdminUserDto[] }>('/api/admins')
      .then((data) => setAdmins(data.admins))
      .catch((error) => toast.error(error instanceof ApiError ? error.message : 'Nie udało się pobrać zespołu'));
  }, [me.role, toast]);

  if (!hasFullAccess(me.role)) return <Navigate to="/admin" replace />;

  function replace(updated: AdminUserDto) {
    setAdmins((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? prev);
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await api.post<{ admin: AdminUserDto }>('/api/admins', { email, password, role });
      setAdmins((prev) => [...(prev ?? []), data.admin]);
      try {
        await navigator.clipboard.writeText(`${email}\n${password}`);
        toast.success('Dodano konto — e-mail i hasło skopiowano do schowka');
      } catch {
        toast.success('Dodano konto — przekaż hasło tej osobie');
      }
      setEmail('');
      setPassword(generatePassword());
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się dodać konta');
    } finally {
      setBusy(false);
    }
  }

  async function update(
    admin: AdminUserDto,
    patch: { role?: AssignableAdminRole; disabled?: boolean; password?: string; currentPassword?: string },
  ) {
    try {
      const data = await api.patch<{ admin: AdminUserDto }>(`/api/admins/${admin.id}`, patch);
      replace(data.admin);
      return true;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się zapisać zmian');
      return false;
    }
  }

  async function changeRole(admin: AdminUserDto, nextRole: AssignableAdminRole) {
    if (await update(admin, { role: nextRole })) toast.success(`${admin.email}: ${roleLabel(nextRole).toLowerCase()}`);
  }

  async function toggleDisabled(admin: AdminUserDto) {
    if (!admin.disabled) {
      const ok = await confirm({
        title: `Zablokować konto ${admin.email}?`,
        description: 'Osoba zostanie od razu wylogowana i nie zaloguje się ponownie, dopóki jej nie odblokujesz.',
        confirmLabel: 'Zablokuj',
        tone: 'danger',
      });
      if (!ok) return;
    }
    if (await update(admin, { disabled: !admin.disabled })) {
      toast.success(admin.disabled ? 'Konto odblokowane' : 'Konto zablokowane');
    }
  }

  async function resetPassword(admin: AdminUserDto) {
    const ok = await confirm({
      title: `Ustawić nowe hasło dla ${admin.email}?`,
      description: 'Wygenerujemy nowe hasło i skopiujemy je do schowka. Dotychczasowe sesje tej osoby zostaną wylogowane.',
      confirmLabel: 'Ustaw nowe hasło',
    });
    if (!ok) return;
    const next = generatePassword();
    if (!(await update(admin, { password: next }))) return;
    try {
      await navigator.clipboard.writeText(next);
      toast.success('Nowe hasło skopiowano do schowka');
    } catch {
      toast.success(`Nowe hasło: ${next}`);
    }
  }

  async function deleteAccount(admin: AdminUserDto) {
    const ok = await confirm({
      title: `Usunąć konto ${admin.email}?`,
      description:
        'Konto zostanie trwale usunięte, a osoba od razu wylogowana. Wpisy w dzienniku zmian i utworzone wydarzenia zostaną zachowane.',
      confirmLabel: 'Usuń konto',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/api/admins/${admin.id}`);
      setAdmins((prev) => prev?.filter((a) => a.id !== admin.id) ?? prev);
      toast.success(`Usunięto konto ${admin.email}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Nie udało się usunąć konta');
    }
  }

  /** Super administrator zmienia własne hasło — z potwierdzeniem obecnego. */
  async function changeOwnPassword(event: FormEvent) {
    event.preventDefault();
    const self = admins?.find((a) => a.id === me.id);
    if (!self || !ownPassword) return;
    if (ownPassword.next !== ownPassword.repeat) {
      toast.error('Nowe hasła się różnią');
      return;
    }
    setBusy(true);
    if (await update(self, { password: ownPassword.next, currentPassword: ownPassword.current })) {
      toast.success('Hasło zmienione — pozostałe urządzenia zostały wylogowane');
      setOwnPassword(null);
    }
    setBusy(false);
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Zespół</h1>
        <p className="text-sm text-slate-500">Konta z dostępem do panelu i ich uprawnienia.</p>
      </div>

      <div className="card p-0">
        {!admins ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Ładowanie zespołu…
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {admins.map((admin) => {
              const isMe = admin.id === me.id;
              const isSuper = admin.role === 'SUPER_ADMIN';
              return (
                <li key={admin.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate font-medium ${admin.disabled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                      {admin.email}
                      {isMe && <span className="ml-2 text-xs font-normal text-slate-400">(Ty)</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {admin.lastSeenAt ? `Ostatnio aktywne: ${formatDateTime(admin.lastSeenAt)}` : 'Jeszcze się nie logowało'}
                      {admin.disabled && ' · zablokowane'}
                    </p>
                  </div>
                  {/* Konto super administratora pochodzi z env — w panelu nie zmienia się jego roli ani blokady. */}
                  {isSuper ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1.5 text-sm font-medium text-amber-900">
                      <Crown className="h-4 w-4" aria-hidden />
                      Super administrator
                    </span>
                  ) : (
                    <select
                      className="input w-auto py-2 pr-8"
                      aria-label={`Rola: ${admin.email}`}
                      value={admin.role}
                      disabled={isMe}
                      onChange={(e) => void changeRole(admin, e.target.value as AssignableAdminRole)}
                    >
                      {ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {isMe && isSuper && !ownPassword && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setOwnPassword({ current: '', next: '', repeat: '' })}
                    >
                      <KeyRound className="h-4 w-4" aria-hidden />
                      Zmień hasło
                    </button>
                  )}
                  {!isMe && !isSuper && (
                    <Menu
                      align="right"
                      triggerLabel={`Więcej akcji: ${admin.email}`}
                      triggerClassName="btn-secondary px-3"
                      trigger={<Ellipsis className="h-4 w-4" aria-hidden />}
                      items={[
                        { label: 'Ustaw nowe hasło', icon: KeyRound, onSelect: () => void resetPassword(admin) },
                        admin.disabled
                          ? { label: 'Odblokuj konto', icon: RotateCcw, onSelect: () => void toggleDisabled(admin) }
                          : { label: 'Zablokuj konto', icon: Ban, tone: 'danger', onSelect: () => void toggleDisabled(admin) },
                        // Usuwanie kont jest zarezerwowane dla super administratora.
                        ...(me.role === 'SUPER_ADMIN'
                          ? [{ label: 'Usuń konto', icon: Trash2, tone: 'danger' as const, onSelect: () => void deleteAccount(admin) }]
                          : []),
                      ]}
                    />
                  )}
                  {isMe && isSuper && ownPassword && (
                    <form onSubmit={changeOwnPassword} className="grid w-full gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
                      <div>
                        <label className="label" htmlFor="own-current-password">
                          Obecne hasło
                        </label>
                        <input
                          id="own-current-password"
                          type="password"
                          className="input"
                          required
                          autoComplete="current-password"
                          value={ownPassword.current}
                          onChange={(e) => setOwnPassword({ ...ownPassword, current: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor="own-new-password">
                          Nowe hasło
                        </label>
                        <input
                          id="own-new-password"
                          type="password"
                          className="input"
                          required
                          minLength={12}
                          autoComplete="new-password"
                          value={ownPassword.next}
                          onChange={(e) => setOwnPassword({ ...ownPassword, next: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label" htmlFor="own-repeat-password">
                          Powtórz nowe hasło
                        </label>
                        <input
                          id="own-repeat-password"
                          type="password"
                          className="input"
                          required
                          minLength={12}
                          autoComplete="new-password"
                          value={ownPassword.repeat}
                          onChange={(e) => setOwnPassword({ ...ownPassword, repeat: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2 sm:col-span-3">
                        <button type="submit" className="btn-primary" disabled={busy}>
                          {busy ? 'Zapisywanie…' : 'Zapisz hasło'}
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => setOwnPassword(null)}>
                          Anuluj
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form onSubmit={createAccount} className="card space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <UserPlus className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-medium leading-tight">Dodaj osobę</h2>
            <p className="text-sm text-slate-500">Hasło startowe generuje się samo — po dodaniu trafi do schowka.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="new-admin-email">
              E-mail
            </label>
            <input
              id="new-admin-email"
              type="email"
              className="input"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="new-admin-password">
              Hasło startowe
            </label>
            <input
              id="new-admin-password"
              className="input font-mono"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <fieldset>
          <legend className="label">Uprawnienia</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand-200 ${
                  role === option.value ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-brand-300'
                }`}
              >
                <input
                  type="radio"
                  name="new-admin-role"
                  className="mt-1 accent-brand-600"
                  checked={role === option.value}
                  onChange={() => setRole(option.value)}
                />
                <span>
                  <span className="flex items-center gap-1.5 font-medium text-slate-900">
                    {option.value === 'ADMIN' && <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden />}
                    {option.label}
                  </span>
                  <span className="block text-xs text-slate-500">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn-primary" disabled={busy}>
          <UserPlus className="h-4 w-4" aria-hidden />
          {busy ? 'Dodawanie…' : 'Dodaj konto'}
        </button>
      </form>
    </section>
  );
}
