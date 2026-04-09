import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ALLOWED_TYPES = new Map<string, string>([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

type UploadedAvatarFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getSafeUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return null;
    }

    return this.toSafeUser(user);
  }

  async searchUsers(query: string, currentUserId: string) {
    const term = query.trim();

    if (!term) {
      return [];
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        OR: [
          {
            email: {
              contains: term,
              mode: "insensitive",
            },
          },
          {
            displayName: {
              contains: term,
              mode: "insensitive",
            },
          },
        ],
      },
      take: 10,
      orderBy: {
        displayName: "asc",
      },
    });

    return users.map((user) => this.toSafeUser(user));
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const existingUser = await this.requireUser(userId);

    const nextDisplayName = dto.displayName?.trim();

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: nextDisplayName || existingUser.displayName,
      },
    });

    return this.toSafeUser(user);
  }

  async updateAvatar(userId: string, file: UploadedAvatarFile | undefined) {
    if (!file) {
      throw new BadRequestException("Выберите изображение для аватарки.");
    }

    const extension = AVATAR_ALLOWED_TYPES.get(file.mimetype);

    if (!extension) {
      throw new BadRequestException("Поддерживаются только PNG, JPEG и WEBP изображения.");
    }

    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException("Размер аватарки не должен превышать 5 MB.");
    }

    const existingUser = await this.requireUser(userId);
    const avatarsDir = await this.ensureAvatarUploadsDir();
    const storageKey = `${randomUUID()}${extension}`;
    const absolutePath = join(avatarsDir, storageKey);
    const previousStorageKey = this.extractAvatarStorageKey(existingUser.avatarUrl);

    await writeFile(absolutePath, file.buffer);

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          avatarUrl: `/users/avatar-files/${storageKey}?v=${Date.now()}`,
        },
      });

      await this.cleanupAvatarFile(previousStorageKey);
      return this.toSafeUser(user);
    } catch (error) {
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  }

  async removeAvatar(userId: string) {
    const existingUser = await this.requireUser(userId);
    const previousStorageKey = this.extractAvatarStorageKey(existingUser.avatarUrl);

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarUrl: null,
      },
    });

    await this.cleanupAvatarFile(previousStorageKey);
    return this.toSafeUser(user);
  }

  async getAvatarDownload(storageKey: string) {
    const safeStorageKey = basename(storageKey);
    const absolutePath = join(this.getAvatarUploadsDir(), safeStorageKey);

    if (!existsSync(absolutePath)) {
      throw new NotFoundException("Avatar not found");
    }

    return {
      absolutePath,
      mimeType: this.getAvatarMimeType(safeStorageKey),
    };
  }

  async touchLastSeen(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }

  private async requireUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  private toSafeUser(user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    lastSeenAt: Date | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    };
  }

  private getAvatarUploadsDir() {
    const baseUploadsDir =
      this.configService.get<string>("UPLOADS_DIR") || join(process.cwd(), "uploads");

    return join(baseUploadsDir, "avatars");
  }

  private async ensureAvatarUploadsDir() {
    const avatarsDir = this.getAvatarUploadsDir();
    await mkdir(avatarsDir, { recursive: true });
    return avatarsDir;
  }

  private extractAvatarStorageKey(avatarUrl: string | null) {
    if (!avatarUrl || !avatarUrl.startsWith("/users/avatar-files/")) {
      return null;
    }

    return basename(avatarUrl.split("?")[0] ?? "");
  }

  private async cleanupAvatarFile(storageKey: string | null) {
    if (!storageKey) {
      return;
    }

    const absolutePath = join(this.getAvatarUploadsDir(), basename(storageKey));
    await unlink(absolutePath).catch(() => undefined);
  }

  private getAvatarMimeType(storageKey: string) {
    const extension = extname(storageKey).toLowerCase();

    switch (extension) {
      case ".png":
        return "image/png";
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".webp":
        return "image/webp";
      default:
        return "application/octet-stream";
    }
  }
}
