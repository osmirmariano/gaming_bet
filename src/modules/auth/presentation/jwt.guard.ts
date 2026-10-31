import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type Role = "ADMIN" | "OPERATOR" | "AUDITOR";
export const Roles = (...roles: Role[]) => SetMetadata("roles", roles);
export type AdminRequest = FastifyRequest & {
  admin?: { id: string; roles: Role[] };
};
@Injectable()
export class JwtRoleGuard implements CanActivate {
  private readonly issuer = process.env.OIDC_ISSUER_URL;
  private readonly audience = process.env.OIDC_AUDIENCE ?? "wager-api";
  private readonly jwksUrl =
    process.env.OIDC_JWKS_URL ??
    (this.issuer ? `${this.issuer}/protocol/openid-connect/certs` : undefined);
  private readonly jwks = this.jwksUrl
    ? createRemoteJWKSet(new URL(this.jwksUrl))
    : undefined;
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer "))
      throw new UnauthorizedException("MISSING_BEARER_TOKEN");
    try {
      if (!this.issuer || !this.jwks)
        throw new Error("OIDC issuer or JWKS URL is not configured");
      const { payload } = await jwtVerify(authorization.slice(7), this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
      });
      const id = payload.sub;
      if (typeof id !== "string") throw new Error("Invalid subject");
      const roles = keycloakRoles(payload.realm_access);
      if (roles.length === 0) throw new Error("Missing accepted role");
      const permitted = Reflect.getMetadata("roles", context.getHandler()) as
        | Role[]
        | undefined;
      if (permitted && !permitted.some((role) => roles.includes(role)))
        throw new UnauthorizedException("INSUFFICIENT_ROLE");
      request.admin = { id, roles };
      return true;
    } catch {
      throw new UnauthorizedException("INVALID_BEARER_TOKEN");
    }
  }
}

function keycloakRoles(claim: unknown): Role[] {
  if (claim === null || typeof claim !== "object") return [];
  const candidate = (claim as { roles?: unknown }).roles;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(
    (role): role is Role =>
      typeof role === "string" &&
      ["ADMIN", "OPERATOR", "AUDITOR"].includes(role),
  );
}
