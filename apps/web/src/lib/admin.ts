import { createContext, useContext } from 'react';
import { hasFullAccess, type AdminMeDto } from '@syjonevent/shared';

/** Zalogowany administrator — ustawiany przez AdminLayout po sprawdzeniu sesji. */
export const AdminContext = createContext<AdminMeDto | null>(null);

export function useAdmin(): AdminMeDto {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error('useAdmin poza AdminLayout');
  return admin;
}

/** Konto "tylko podgląd" nie może niczego zmieniać — przyciski edycji chowamy albo wyłączamy. */
export function useCanEdit(): boolean {
  return hasFullAccess(useAdmin().role);
}
