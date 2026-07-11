import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class SupportEventsService {
  private readonly logger = new Logger(SupportEventsService.name);
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  emitNewMessage(result: {
    conversation: { userId: string };
    message: Record<string, any>;
  }) {
    if (!this.server) {
      return;
    }

    const userRoom = this.userRoom(result.conversation.userId);
    this.server.to(userRoom).emit('support:new_message', result);
    this.server.to('admins').emit('support:new_message', result);
    this.server
      .to('admins')
      .emit('support:conversation_updated', result.conversation);
  }

  emitMessagesRead(conversation: { userId: string }) {
    if (!this.server) {
      return;
    }

    const userRoom = this.userRoom(conversation.userId);
    this.server.to(userRoom).to('admins').emit('support:messages_read', conversation);
  }

  emitConversationUpdated(conversation: { userId: string }) {
    if (!this.server) {
      return;
    }

    const userRoom = this.userRoom(conversation.userId);
    this.server
      .to(userRoom)
      .to('admins')
      .emit('support:conversation_updated', conversation);
  }

  /** Notify all connected admins when a new order is placed. */
  emitNewOrder(order: { _id: string; orderNumber: string; userId: string }) {
    if (!this.server) return;
    this.server.to('admins').emit('order:new', order);
  }

  /** Notify all connected admins when an order status changes. */
  emitOrderUpdated(order: { _id: string; orderNumber: string; status: string; userId: string }) {
    if (!this.server) return;
    this.server.to('admins').emit('order:updated', order);
  }

  private userRoom(userId: string) {
    if (!userId) {
      this.logger.warn('Attempted to emit support event without userId');
    }
    return `user:${userId}`;
  }
}
