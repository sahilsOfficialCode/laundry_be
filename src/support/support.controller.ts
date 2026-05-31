import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { SendMessageDto } from './dto/send-message.dto';
import { SupportEventsService } from './support-events.service';
import { SupportService } from './support.service';

@Controller('support')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupportController {
  constructor(
    private readonly supportService: SupportService,
    private readonly supportEvents: SupportEventsService,
  ) {}

  @Get('conversation')
  async getMyConversation(@GetUser() user: any) {
    return this.supportService.getUserConversation(user);
  }

  @Get('conversations')
  @Roles(UserRole.ADMIN)
  async getAdminConversations(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 30,
  ) {
    return this.supportService.getAdminConversations(page, limit);
  }

  @Get('conversations/:id/messages')
  async getMessages(
    @Param('id') conversationId: string,
    @GetUser() user: any,
    @Query('limit') limit: number = 30,
    @Query('before') before?: string,
  ) {
    return this.supportService.getMessages(
      conversationId,
      user,
      limit,
      before,
    );
  }

  @Post('messages')
  async sendMessage(@GetUser() user: any, @Body() dto: SendMessageDto) {
    const result = await this.supportService.sendMessage(user, dto);
    this.supportEvents.emitNewMessage(result);
    return result;
  }

  @Patch('conversations/:id/read')
  async markConversationRead(
    @Param('id') conversationId: string,
    @GetUser() user: any,
  ) {
    const conversation = await this.supportService.markConversationRead(
      conversationId,
      user,
    );
    this.supportEvents.emitMessagesRead(conversation);
    return conversation;
  }
}
