import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LocationAuditLogDocument = LocationAuditLog & Document;

export enum LocationAuditAction {
  CREATED = 'created',
  UPDATED = 'updated',
  ACTIVATED = 'activated',
  DEACTIVATED = 'deactivated',
  CLOSURE_CREATED = 'closure_created',
  CLOSURE_UPDATED = 'closure_updated',
  CLOSURE_DEACTIVATED = 'closure_deactivated',
}

@Schema({ timestamps: true })
export class LocationAuditLog {
  @Prop({ required: true, index: true })
  locationId: string;

  @Prop({ enum: LocationAuditAction, required: true })
  action: LocationAuditAction;

  @Prop({ required: true })
  actorId: string;

  @Prop({ required: true })
  actorRole: string;

  @Prop({ type: Object, required: false })
  before?: Record<string, any>;

  @Prop({ type: Object, required: false })
  after?: Record<string, any>;

  @Prop({ type: Object, required: false })
  metadata?: Record<string, any>;
}

export const LocationAuditLogSchema =
  SchemaFactory.createForClass(LocationAuditLog);

LocationAuditLogSchema.index({ locationId: 1, createdAt: -1 });
