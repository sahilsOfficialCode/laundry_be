import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceAvailabilityService } from './service-availability.service';
import { ServiceAvailabilityConfig } from './schemas/service-availability-config.schema';

describe('ServiceAvailabilityService', () => {
  let service: ServiceAvailabilityService;
  let configDoc: any;

  beforeEach(async () => {
    configDoc = {
      key: 'GLOBAL',
      instantEnabled: true,
      instantStartTime: '00:00',
      instantEndTime: '20:00',
      scheduledEnabled: true,
      scheduledStartTime: '00:00',
      scheduledEndTime: '23:59',
    };

    const configModel = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(configDoc) }),
      create: jest.fn().mockResolvedValue({ toObject: () => configDoc }),
      findOneAndUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceAvailabilityService,
        { provide: getModelToken(ServiceAvailabilityConfig.name), useValue: configModel },
      ],
    }).compile();

    service = module.get(ServiceAvailabilityService);
  });

  // IST = UTC+5:30, so 14:29:59 UTC is 19:59:59 IST and 14:30:00 UTC is
  // 20:00:00 IST — the boundary around the default 20:00 instant cutoff.
  const justBeforeCutoffUTC = new Date('2026-07-12T14:29:59.000Z');
  const atCutoffUTC = new Date('2026-07-12T14:30:00.000Z');

  it('instant: available before the configured end time', async () => {
    expect(await service.isInstantAvailable(justBeforeCutoffUTC)).toBe(true);
  });

  it('instant: unavailable at/after the configured end time', async () => {
    expect(await service.isInstantAvailable(atCutoffUTC)).toBe(false);
  });

  it('instant: unavailable when disabled, regardless of time', async () => {
    configDoc.instantEnabled = false;
    expect(await service.isInstantAvailable(justBeforeCutoffUTC)).toBe(false);
  });

  it('scheduled: available within the default all-day window', async () => {
    expect(await service.isScheduledAvailable(new Date('2026-07-12T18:00:00.000Z'))).toBe(true);
  });

  it('scheduled: unavailable when disabled', async () => {
    configDoc.scheduledEnabled = false;
    expect(await service.isScheduledAvailable(new Date('2026-07-12T18:00:00.000Z'))).toBe(false);
  });

  it('respects a custom configured window', async () => {
    configDoc.instantEndTime = '18:00';
    // 12:00 UTC = 17:30 IST -> still before 18:00 cutoff
    expect(await service.isInstantAvailable(new Date('2026-07-12T12:00:00.000Z'))).toBe(true);
    // 12:30 UTC = 18:00 IST -> at cutoff, unavailable
    expect(await service.isInstantAvailable(new Date('2026-07-12T12:30:00.000Z'))).toBe(false);
  });
});
