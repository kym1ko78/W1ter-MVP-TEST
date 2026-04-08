import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new NotFoundException("User not found");
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        displayName: dto.displayName?.trim() ?? existingUser.displayName,
        avatarUrl: dto.avatarUrl ?? existingUser.avatarUrl,
      },
    });

    return this.toSafeUser(user);
  }

  async touchLastSeen(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        lastSeenAt: new Date(),
      },
    });
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
}

