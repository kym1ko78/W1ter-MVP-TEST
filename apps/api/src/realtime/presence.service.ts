import { Injectable } from "@nestjs/common";

@Injectable()
export class PresenceService {
  private readonly connections = new Map<string, Set<string>>();

  connect(userId: string, socketId: string) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }

    this.connections.get(userId)?.add(socketId);
  }

  disconnect(userId: string, socketId: string) {
    const sockets = this.connections.get(userId);

    if (!sockets) {
      return false;
    }

    sockets.delete(socketId);

    if (sockets.size === 0) {
      this.connections.delete(userId);
      return false;
    }

    return true;
  }
}

