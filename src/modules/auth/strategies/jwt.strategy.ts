import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { Role } from "../../../common/enums/role.enum";

export interface JwtPayload {
    sub: string;
    email: string;
    role: Role;
    trialEndsAt?: string | null;
    isActive?: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private readonly configService: ConfigService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('JWT_SECRET') || 'default_secret_key_vamos_aprendiendo',
        });
    }

    async validate(payload: JwtPayload) {
        if (!payload.sub || !payload.email) {
            throw new UnauthorizedException('Token inválido');
        }
        return {
            userId: payload.sub,
            email: payload.email,
            role: payload.role || Role.TEST,
            trialEndsAt: payload.trialEndsAt || null,
            isActive: payload.isActive !== false,
        };
    }
}