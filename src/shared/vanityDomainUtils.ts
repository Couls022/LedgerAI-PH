/**
 * Enterprise Vanity Domain & Tenant Route Utilities for LedgerAI PH.
 * Formats URLs in a clean, professional enterprise domain structure:
 * e.g., 'ledgeraiph.<company-slug>.com' under '/client/' or '/server/'.
 */

export function slugifyCompanyName(rawName: string): string {
  if (!rawName) return 'workspace';
  return rawName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9]+/g, '-')     // replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')         // trim leading/trailing hyphens
    .slice(0, 60) || 'workspace';
}

export interface CompanyReference {
  id: string;
  legalName?: string | null;
  tradeName?: string | null;
}

/**
 * Builds the enterprise vanity domain for a company.
 * Example: 'ledgeraiph.deskguard-solutions.com'
 */
export function getCompanyVanityDomain(company: CompanyReference | string): string {
  if (!company) return 'ledgeraiph.workspace.com';
  if (typeof company === 'string') {
    if (isVanityDomain(company)) return company;
    return `ledgeraiph.${slugifyCompanyName(company)}.com`;
  }
  const base = company.legalName || company.tradeName || company.id;
  return `ledgeraiph.${slugifyCompanyName(base)}.com`;
}

/**
 * Checks if a route parameter or string matches the vanity domain format.
 */
export function isVanityDomain(val: string): boolean {
  if (!val) return false;
  return /^ledgeraiph\.[a-z0-9-]+\.com$/i.test(val.trim());
}

/**
 * Extracts the inner slug from a vanity domain.
 * e.g., 'ledgeraiph.acme-corp.com' -> 'acme-corp'
 */
export function extractSlugFromVanityDomain(val: string): string {
  if (!val) return '';
  const match = val.trim().match(/^ledgeraiph\.(.+?)\.com$/i);
  return match ? match[1] : val;
}

/**
 * Resolves a company ID from either a raw ID (e.g. 'LGR-PH-2026-ACME-01')
 * or a vanity domain (e.g. 'ledgeraiph.acme-manufacturing-corp.com').
 */
export function resolveCompanyIdFromParam(
  param: string,
  companiesList: CompanyReference[] = []
): string {
  if (!param) return '';
  const cleanParam = decodeURIComponent(param).trim();

  // 1. Direct match by ID
  const directMatch = companiesList.find(
    (c) => c.id.toLowerCase() === cleanParam.toLowerCase()
  );
  if (directMatch) return directMatch.id;

  // 2. Vanity domain match: 'ledgeraiph.<slug>.com'
  if (isVanityDomain(cleanParam)) {
    const slug = extractSlugFromVanityDomain(cleanParam);
    const domainMatch = companiesList.find((c) => {
      const cDomain = getCompanyVanityDomain(c);
      if (cDomain.toLowerCase() === cleanParam.toLowerCase()) return true;
      const cSlug = slugifyCompanyName(c.legalName || c.tradeName || c.id);
      if (cSlug === slug) return true;
      const idSlug = slugifyCompanyName(c.id);
      if (idSlug === slug) return true;
      if (c.tradeName && slugifyCompanyName(c.tradeName) === slug) return true;
      return false;
    });
    if (domainMatch) return domainMatch.id;
  }

  // 3. Match by slugified legal name, trade name, or company ID
  const slugMatch = companiesList.find((c) => {
    const nameSlug = slugifyCompanyName(c.legalName || c.tradeName || c.id);
    const idSlug = slugifyCompanyName(c.id);
    const target = cleanParam.toLowerCase();
    return nameSlug === target || idSlug === target || c.id.toLowerCase() === target;
  });
  if (slugMatch) return slugMatch.id;

  // 4. Return as-is if no exact ID or vanity-slug match exists (never substring-match cloned IDs onto parents)
  return cleanParam;
}

/**
 * Extracts the tenant routing prefix from the current pathname.
 * e.g. '/client/ledgeraiph.deskguard.com/tax/forms' -> '/client/ledgeraiph.deskguard.com'
 * e.g. '/server/ledgeraiph.acme.com/accounting' -> '/server/ledgeraiph.acme.com'
 */
export function getTenantPrefix(pathname: string): string {
  if (!pathname) return '';
  const match = pathname.match(/^(\/(?:client|server)\/[^\/]+)/);
  return match ? match[1] : '';
}

/**
 * Prepends the current tenant prefix to an internal application route if not already prefixed.
 * e.g. toPrefixedRoute('/accounting/journals', '/client/ledgeraiph.acme.com/dashboard')
 *      -> '/client/ledgeraiph.acme.com/accounting/journals'
 */
export function toPrefixedRoute(route: string, currentPathname: string): string {
  const prefix = getTenantPrefix(currentPathname);
  if (!prefix) return route;
  if (!route || route === '/') return `${prefix}/dashboard`;
  if (route.startsWith(prefix)) return route;
  const cleanRoute = route.startsWith('/') ? route : `/${route}`;
  return `${prefix}${cleanRoute}`;
}
