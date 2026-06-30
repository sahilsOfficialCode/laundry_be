import {
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '../users/schemas/user.schema';
import { SendMessageDto } from './dto/send-message.dto';
import { SupportEventsService } from './support-events.service';
import { SupportService } from './support.service';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class SupportGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly supportService: SupportService,
    private readonly supportEvents: SupportEventsService,
  ) {}

  afterInit(server: Server) {
    this.supportEvents.setServer(server);
  }

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      const result = await this.authService.verifyToken(token);
      client.data.user = result.user;

      client.join(this.userRoom(result.user.sub));
      if (result.user.role === UserRole.ADMIN) {
        client.join('admins');
      }
    } catch (error) {
      console.log("<><>working error")
      client.emit('support:error', {
        message: 'Authentication failed',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    client.removeAllListeners();
  }

  @SubscribeMessage('support:send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessageDto,
  ) {
    const user = this.requireSocketUser(client);
    const result = await this.supportService.sendMessage(user, payload);
    this.supportEvents.emitNewMessage(result);

    return result;
  }

  @SubscribeMessage('support:mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const user = this.requireSocketUser(client);
    const conversation = await this.supportService.markConversationRead(
      payload.conversationId,
      user,
    );
    this.supportEvents.emitMessagesRead(conversation);

    return conversation;
  }

  @SubscribeMessage('support:typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId?: string; isTyping?: boolean },
  ) {
    const user = this.requireSocketUser(client);

    const conversation =
      user.role === UserRole.ADMIN
        ? await this.supportService.getAuthorizedConversation(
            payload.conversationId ?? '',
            user,
          )
        : await this.supportService.getUserConversation(user);

    const normalized = {
      conversationId: String(conversation._id),
      senderRole: user.role,
      isTyping: Boolean(payload.isTyping),
    };

    if (user.role === UserRole.ADMIN) {
      this.server
        .to(this.userRoom(conversation.userId))
        .emit('support:typing', normalized);
      return normalized;
    }

    this.server.to('admins').emit('support:typing', normalized);
    return normalized;
  }

  private extractToken(client: Socket) {
    const authToken = client.handshake.auth?.token;
    const header = client.handshake.headers.authorization;
    const bearerToken =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : undefined;
    const token = authToken || bearerToken;

    if (!token || typeof token !== 'string') {
      throw new WsException('No authentication token provided');
    }

    return token;
  }

  private requireSocketUser(client: Socket) {
    const user = client.data.user;
    if (!user?.sub || !user?.role) {
      throw new WsException('Unauthenticated socket');
    }

    return user;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }
}
