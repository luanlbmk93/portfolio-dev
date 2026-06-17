/** Base do app em produção: ex. `/extrato` (sem barra final). */
export function appBase(): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

/** Rotas da API e do backend no mesmo domínio. */
export function apiPath(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = appBase();
  return base ? `${base}${p}` : p;
}
