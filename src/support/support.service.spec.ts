import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { UserRole } from '../users/schemas/user.schema';
import { SupportService } from './support.service';

const query = <T>(value: T) => ({
  exec: jest.fn().mockResolvedValue(value),
});

const leanQuery = <T>(value: T) => ({
  lean: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue(value),
});

describe('SupportService', () => {
  const user = {
    sub: '507f1f77bcf86cd799439011',
    email: 'user@example.com',
    role: UserRole.USER,
  };
  const admin = {
    sub: '507f1f77bcf86cd799439012',
    email: 'admin@example.com',
    role: UserRole.ADMIN,
  };
  const conversation = {
    _id: '507f1f77bcf86cd799439013',
    userId: user.sub,
    unreadForUser: 0,
    unreadForAdmin: 0,
  };

  function createService(overrides: Record<string, any> = {}) {
    const conversationModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(query(conversation)),
      findById: jest.fn().mockReturnValue(query(conversation)),
      findByIdAndUpdate: jest.fn().mockReturnValue(leanQuery(conversation)),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      countDocuments: jest.fn().mockReturnValue(query(0)),
      ...overrides.conversationModel,
    };

    const messageModel = {
      create: jest.fn().mockResolvedValue({
        toObject: () => ({
          _id: '507f1f77bcf86cd799439014',
          conversationId: conversation._id,
          body: 'hello',
        }),
      }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      ...overrides.messageModel,
    };

    const userModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      }),
      ...overrides.userModel,
    };

    return {
      service: new SupportService(
        conversationModel as any,
        messageModel as any,
        userModel as any,
      ),
      conversationModel,
      messageModel,
    };
  }

  it('creates/reuses a user conversation and increments admin unread count', async () => {
    const { service, conversationModel, messageModel } = createService();

    await service.sendMessage(user, { body: '  hello  ' });

    expect(conversationModel.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: user.sub },
      expect.any(Object),
      expect.objectContaining({ upsert: true }),
    );
    expect(messageModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: conversation._id,
        senderId: user.sub,
        senderRole: UserRole.USER,
        body: 'hello',
      }),
    );
    expect(conversationModel.findByIdAndUpdate).toHaveBeenCalledWith(
      conversation._id,
      expect.objectContaining({
        $inc: { unreadForAdmin: 1 },
      }),
      { new: true },
    );
  });

  it('requires admins to provide a valid conversationId', async () => {
    const { service } = createService();

    await expect(service.sendMessage(admin, { body: 'reply' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('prevents users from reading another user conversation', async () => {
    const { service } = createService({
      conversationModel: {
        findById: jest.fn().mockReturnValue(
          query({
            ...conversation,
            userId: '507f1f77bcf86cd799439099',
          }),
        ),
      },
    });

    await expect(
      service.getMessages(conversation._id, user),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects empty messages after trimming', async () => {
    const { service } = createService();

    await expect(service.sendMessage(user, { body: '   ' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
