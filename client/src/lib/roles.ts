import type { Role } from '@/types/api';

export const ROLE_LABEL: Record<Role, string> = { gestor: 'Gestor', admin: 'Admin', superadmin: 'SuperAdmin' };
export const ROLE_HELP: Record<Role, string> = {
  gestor: 'Vê só os domínios do Squad dele e os módulos liberados em Permissões.',
  admin: 'Vê e edita tudo (usuários, domínios, contas), menos conectar integrações e mudar a frequência do sync.',
  superadmin: 'Acesso a todas as funções, inclusive conectar integrações e mudar a frequência de sincronização.',
};
export const roleTone = (r: Role) => (r === 'superadmin' ? 'pos' : r === 'admin' ? 'accent' : 'na') as 'pos' | 'accent' | 'na';
