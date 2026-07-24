import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type InvoiceCounterDocument = InvoiceCounter & Document;

/**
 * One document per month (e.g. "202607"), atomically incremented via
 * findOneAndUpdate({$inc: {seq: 1}}, {upsert: true}) — collision-free, unlike
 * Order.orderNumber's Date.now()-based scheme, which invoice numbering must
 * not copy.
 */
@Schema({ _id: false })
export class InvoiceCounter {
  @Prop({ required: true })
  _id: string;

  @Prop({ required: true, default: 0 })
  seq: number;
}

export const InvoiceCounterSchema = SchemaFactory.createForClass(InvoiceCounter);
