import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import { User, UserDocument, UserRole } from '../users/schemas/user.schema';
import {
  Conversation,
  ConversationDocument,
  ConversationStatus,
} from './schemas/conversation.schema';
import { Message, MessageDocument } from './schemas/message.schema';
import { SendMessageDto } from './dto/send-message.dto';

type JwtUser = {
  sub: string;
  email: string;
  role: UserRole;
};

@Injectable()
export class SupportService {
  private readonly defaultMessageLimit = 30;
  private readonly maxMessageLimit = 100;

  constructor(
    @InjectModel(Conversation.name)
    private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private messageModel: Model<MessageDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
  ) {}

  async getUserConversation(user: JwtUser) {
    return this.getOrCreateUserConversation(user.sub);
  }

  async getAdminConversations(page = 1, limit = 30) {
    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const [conversations, total] = await Promise.all([
      this.conversationModel
        .find()
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.conversationModel.countDocuments().exec(),
    ]);

    const userIds = conversations.map((conversation) => conversation.userId);
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('name email role isActive')
      .lean()
      .exec();

    const userById = new Map(users.map((user) => [String(user._id), user]));

    return {
      items: conversations.map((conversation) => ({
        ...conversation,
        user: userById.get(conversation.userId) ?? null,
      })),
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async getMessages(
    conversationId: string,
    user: JwtUser,
    limit = this.defaultMessageLimit,
    before?: string,
  ) {
    const conversation = await this.findAuthorizedConversation(
      conversationId,
      user,
    );
    const safeLimit = Math.min(
      Math.max(Number(limit) || this.defaultMessageLimit, 1),
      this.maxMessageLimit,
    );

    const query: Record<string, any> = { conversationId: String(conversation._id) };
    if (before) {
      const beforeDate = new Date(before);
      if (Number.isNaN(beforeDate.getTime())) {
        throw new BadRequestException('before must be a valid ISO date');
      }
      query.createdAt = { $lt: beforeDate };
    }

    const messages = await this.messageModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean()
      .exec();

    return messages.reverse();
  }

  async sendMessage(user: JwtUser, dto: SendMessageDto) {
    const body = this.normalizeBody(dto.body);
    const conversation =
      user.role === UserRole.ADMIN
        ? await this.getAdminTargetConversation(dto.conversationId)
        : await this.getOrCreateUserConversation(user.sub);

    if (user.role !== UserRole.ADMIN && conversation.userId !== user.sub) {
      throw new ForbiddenException('Cannot send to another user conversation');
    }

    const message = await this.messageModel.create({
      conversationId: String(conversation._id),
      senderId: user.sub,
      senderRole: user.role,
      body,
    });

    const updatedConversation = await this.updateConversationAfterMessage(
      String(conversation._id),
      body,
      user.role,
    );

    return {
      conversation: updatedConversation,
      message: message.toObject(),
    };
  }

  async markConversationRead(conversationId: string, user: JwtUser) {
    const conversation = await this.findAuthorizedConversation(
      conversationId,
      user,
    );

    const now = new Date();
    if (user.role === UserRole.ADMIN) {
      await this.messageModel.updateMany(
        {
          conversationId: String(conversation._id),
          senderRole: UserRole.USER,
          readAt: { $exists: false },
        },
        { $set: { readAt: now } },
      );

      const updatedConversation = await this.conversationModel
        .findByIdAndUpdate(
          conversation._id,
          { $set: { unreadForAdmin: 0 } },
          { new: true },
        )
        .lean()
        .exec();

      if (!updatedConversation) {
        throw new NotFoundException('Conversation not found');
      }

      return updatedConversation;
    }

    await this.messageModel.updateMany(
      {
        conversationId: String(conversation._id),
        senderRole: UserRole.ADMIN,
        readAt: { $exists: false },
      },
      { $set: { readAt: now } },
    );

    const updatedConversation = await this.conversationModel
      .findByIdAndUpdate(
        conversation._id,
        { $set: { unreadForUser: 0 } },
        { new: true },
      )
      .lean()
      .exec();

    if (!updatedConversation) {
      throw new NotFoundException('Conversation not found');
    }

    return updatedConversation;
  }

  private async getOrCreateUserConversation(userId: string) {
    return this.conversationModel
      .findOneAndUpdate(
        { userId },
        {
          $setOnInsert: {
            userId,
            status: ConversationStatus.OPEN,
            unreadForUser: 0,
            unreadForAdmin: 0,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  private async getAdminTargetConversation(conversationId?: string) {
    if (!conversationId || !isValidObjectId(conversationId)) {
      throw new BadRequestException('A valid conversationId is required');
    }

    const conversation = await this.conversationModel
      .findById(conversationId)
      .exec();
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  private async findAuthorizedConversation(conversationId: string, user: JwtUser) {
    if (!isValidObjectId(conversationId)) {
      throw new BadRequestException('Invalid conversationId');
    }

    const conversation = await this.conversationModel
      .findById(conversationId)
      .exec();
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (user.role !== UserRole.ADMIN && conversation.userId !== user.sub) {
      throw new ForbiddenException('Cannot access this conversation');
    }

    return conversation;
  }

  private async updateConversationAfterMessage(
    conversationId: string,
    body: string,
    senderRole: UserRole,
  ) {
    const inc =
      senderRole === UserRole.ADMIN
        ? { unreadForUser: 1 }
        : { unreadForAdmin: 1 };

    const conversation = await this.conversationModel
      .findByIdAndUpdate(
        conversationId,
        {
          $set: {
            status: ConversationStatus.OPEN,
            lastMessagePreview: this.preview(body),
            lastMessageAt: new Date(),
          },
          $inc: inc,
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  private normalizeBody(body: string) {
    const normalized = body?.trim();
    if (!normalized) {
      throw new BadRequestException('Message body cannot be empty');
    }

    if (normalized.length > 2000) {
      throw new BadRequestException('Message body cannot exceed 2000 characters');
    }

    return normalized;
  }

  private preview(body: string) {
    return body.length > 140 ? `${body.slice(0, 137)}...` : body;
  }
}
