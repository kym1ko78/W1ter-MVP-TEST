import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import type { JwtPayload } from "../common/types/jwt-payload";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";

type SafeAuthUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  emailVerificationSentAt: Date | null;
  lastSeenAt: Date | null;
};

type SessionMetadata = {
  userAgent?: string;
  ip?: string;
};

type SessionOptions = {
  rememberMe: boolean;
};

type EmailVerificationRequestResult = {
  user: ReturnType<AuthService["toSafeUser"]>;
  emailVerificationPreviewUrl: string | null;
  alreadyVerified: boolean;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async register(dto: RegisterDto, metadata: SessionMetadata) {
    try {
      const passwordHash = await bcrypt.hash(dto.password, 10);

      const user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          displayName: dto.displayName.trim(),
          passwordHash,
        },
      });

      const verification = await this.issueEmailVerification(user.id);
      const session = await this.issueSession(verification.user, metadata, {
        rememberMe: dto.rememberMe ?? false,
      });

      this.logger.log(`Registered user ${user.id} (${user.email})`);
      return {
        ...session,
        emailVerificationPreviewUrl: verification.emailVerificationPreviewUrl,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Email is already in use");
      }

      throw error;
    }
  }

  async login(dto: LoginDto, metadata: SessionMetadata) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const session = await this.issueSession(user, metadata, {
      rememberMe: dto.rememberMe ?? false,
    });

    this.logger.log(`Logged in user ${user.id}`);
    return {
      ...session,
      emailVerificationPreviewUrl: null,
    };
  }

  async refreshSession(refreshToken: string | undefined, metadata: SessionMetadata) {
    if (!refreshToken) {
      throw new UnauthorizedException("Missing refresh token");
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }

    const records = await this.prisma.refreshToken.findMany({
      where: {
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const matchedRecord = await this.findRefreshRecord(records, refreshToken);

    if (!matchedRecord) {
      throw new UnauthorizedException("Refresh token not recognized");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException("User no longer exists");
    }

    await this.prisma.refreshToken.update({
      where: { id: matchedRecord.id },
      data: { revokedAt: new Date() },
    });

    const session = await this.issueSession(user, metadata, {
      rememberMe: matchedRecord.isPersistent,
    });

    this.logger.log(`Refreshed session for user ${user.id}`);
    return {
      ...session,
      emailVerificationPreviewUrl: null,
    };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) {
      return;
    }

    const records = await this.prisma.refreshToken.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    const matchedRecord = await this.findRefreshRecord(records, refreshToken);

    if (!matchedRecord) {
      return;
    }

    await this.prisma.refreshToken.update({
      where: { id: matchedRecord.id },
      data: { revokedAt: new Date() },
    });

    this.logger.log(`Logged out refresh token ${matchedRecord.id}`);
  }

  async me(userId: string) {
    return this.usersService.getSafeUserById(userId);
  }

  async requestEmailVerification(userId: string): Promise<EmailVerificationRequestResult> {
    const user = await this.requireUserRecord(userId);

    if (user.emailVerifiedAt) {
      return {
        user: this.toSafeUser(user),
        emailVerificationPreviewUrl: null,
        alreadyVerified: true,
      };
    }

    const verification = await this.issueEmailVerification(user.id);

    return {
      user: this.toSafeUser(verification.user),
      emailVerificationPreviewUrl: verification.emailVerificationPreviewUrl,
      alreadyVerified: false,
    };
  }

  async confirmEmailVerification(token: string) {
    const normalizedToken = token.trim();

    if (!normalizedToken) {
      throw new BadRequestException("Verification token is required");
    }

    const tokenHash = this.hashEmailVerificationToken(normalizedToken);
    const user = await this.prisma.user.findUnique({
      where: {
        emailVerificationTokenHash: tokenHash,
      },
    });

    if (!user) {
      throw new BadRequestException("Ссылка подтверждения недействительна или устарела.");
    }

    if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt <= new Date()) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerificationTokenHash: null,
          emailVerificationExpiresAt: null,
        },
      });

      throw new BadRequestException("Ссылка подтверждения недействительна или устарела.");
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      },
    });

    this.logger.log(`Verified email for user ${updatedUser.id}`);

    return {
      success: true,
      email: updatedUser.email,
      user: this.toSafeUser(updatedUser),
    };
  }

  private async issueSession(
    user: SafeAuthUser,
    metadata: SessionMetadata,
    options: SessionOptions,
  ) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.getAccessSecret(),
      expiresIn: this.getAccessTtlSeconds(),
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.getRefreshSecret(),
      expiresIn: this.getRefreshTtlDays() * 24 * 60 * 60,
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        isPersistent: options.rememberMe,
        expiresAt: new Date(
          Date.now() + this.getRefreshTtlDays() * 24 * 60 * 60 * 1000,
        ),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ip,
      },
    });

    return {
      accessToken,
      refreshToken,
      rememberMe: options.rememberMe,
      user: this.toSafeUser(user),
    };
  }

  private async issueEmailVerification(userId: string) {
    const token = randomBytes(32).toString("hex");
    const sentAt = new Date();
    const expiresAt = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationTokenHash: this.hashEmailVerificationToken(token),
        emailVerificationExpiresAt: expiresAt,
        emailVerificationSentAt: sentAt,
      },
    });

    return {
      user,
      emailVerificationPreviewUrl: this.getEmailVerificationPreviewUrl(token),
    };
  }

  private getEmailVerificationPreviewUrl(token: string) {
    const environment = this.configService.get<string>("NODE_ENV") ?? "development";

    if (environment === "production") {
      return null;
    }

    const appOrigin =
      this.configService.get<string>("API_CORS_ORIGIN") ?? "http://localhost:3000";

    return `${appOrigin.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  }

  private hashEmailVerificationToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async requireUserRecord(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  private async findRefreshRecord(
    records: Array<{ id: string; tokenHash: string; isPersistent: boolean }>,
    refreshToken: string,
  ) {
    for (const record of records) {
      const matches = await bcrypt.compare(refreshToken, record.tokenHash);
      if (matches) {
        return record;
      }
    }

    return null;
  }

  private toSafeUser(user: SafeAuthUser) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      emailVerificationSentAt: user.emailVerificationSentAt?.toISOString() ?? null,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    };
  }

  private getAccessSecret() {
    return (
      this.configService.get<string>("JWT_ACCESS_SECRET") ??
      "replace-me-with-a-long-random-string"
    );
  }

  private getRefreshSecret() {
    return (
      this.configService.get<string>("JWT_REFRESH_SECRET") ??
      "replace-me-with-a-different-long-random-string"
    );
  }

  private getRefreshTtlDays() {
    return Number(this.configService.get<string>("JWT_REFRESH_TTL_DAYS") ?? 30);
  }

  private getAccessTtlSeconds() {
    const rawValue = this.configService.get<string>("JWT_ACCESS_TTL") ?? "15m";
    const match = rawValue.match(/^(\d+)([smhd])$/);

    if (!match) {
      return 15 * 60;
    }

    const value = Number(match[1]);
    const unit = match[2];

    if (unit === "s") {
      return value;
    }

    if (unit === "m") {
      return value * 60;
    }

    if (unit === "h") {
      return value * 60 * 60;
    }

    return value * 24 * 60 * 60;
  }
}
