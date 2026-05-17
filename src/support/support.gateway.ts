import {
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
import { SupportService } from './support.service';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class SupportGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly supportService: SupportService,
  ) {}

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

    this.server
      .to(this.userRoom(result.conversation.userId))
      .emit('support:new_message', result);
    this.server.to('admins').emit('support:new_message', result);
    this.server
      .to('admins')
      .emit('support:conversation_updated', result.conversation);

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

    this.server
      .to(this.userRoom(conversation.userId))
      .to('admins')
      .emit('support:messages_read', conversation);

    return conversation;
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
