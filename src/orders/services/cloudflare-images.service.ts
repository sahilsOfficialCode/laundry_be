import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';

interface CloudflareApiResponse<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code: number; message: string }>;
}

interface CloudflareImageResult {
  id: string;
  variants: string[];
}

export interface CloudflareImageMetadata {
  cloudflareId: string;
  url: string;
  thumbnailUrl?: string;
}

@Injectable()
export class CloudflareImagesService {
  private readonly logger = new Logger(CloudflareImagesService.name);
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.accountId = this.configService.getOrThrow<string>(
      'CLOUDFLARE_ACCOUNT_ID',
    );
    this.apiToken = this.configService.getOrThrow<string>(
      'CLOUDFLARE_API_TOKEN',
    );
    this.apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`;
  }

  async uploadImage(buffer: Buffer): Promise<CloudflareImageMetadata> {
    const compressedImage = await this.compressImage(buffer);
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([Uint8Array.from(compressedImage)], { type: 'image/webp' }),
      `washed-clothes-${Date.now()}.webp`,
    );

    let response: Response;
    try {
      response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiToken}` },
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.error('Cloudflare image upload request failed', error);
      throw new InternalServerErrorException(
        'Failed to upload image to Cloudflare',
      );
    }

    const payload = await this.parseResponse<CloudflareImageResult>(response);
    const result = payload.result;
    if (
      !response.ok ||
      !payload.success ||
      !result?.id ||
      !result.variants?.length
    ) {
      this.logger.error(
        `Cloudflare image upload failed with status ${response.status}`,
      );
      throw new InternalServerErrorException(
        'Failed to upload image to Cloudflare',
      );
    }

    const thumbnailUrl = result.variants.find((variant) =>
      /\/thumbnail(?:$|\?)/i.test(variant),
    );

    return {
      cloudflareId: result.id,
      url: result.variants[0],
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    };
  }

  async deleteImage(cloudflareId: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `${this.apiUrl}/${encodeURIComponent(cloudflareId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${this.apiToken}` },
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch (error) {
      this.logger.error(
        `Cloudflare image rollback request failed for image ${cloudflareId}`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to delete image from Cloudflare',
      );
    }

    const payload = await this.parseResponse<unknown>(response);
    if (!response.ok || !payload.success) {
      this.logger.error(
        `Cloudflare image rollback failed for image ${cloudflareId} with status ${response.status}`,
      );
      throw new InternalServerErrorException(
        'Failed to delete image from Cloudflare',
      );
    }
  }

  private async compressImage(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
    } catch (error) {
      this.logger.warn('Uploaded file could not be processed as an image');
      throw new BadRequestException('Invalid or corrupt image file');
    }
  }

  private async parseResponse<T>(
    response: Response,
  ): Promise<CloudflareApiResponse<T>> {
    try {
      return (await response.json()) as CloudflareApiResponse<T>;
    } catch (error) {
      this.logger.error(
        `Cloudflare returned an invalid response with status ${response.status}`,
      );
      throw new InternalServerErrorException(
        'Invalid response from Cloudflare',
      );
    }
  }
}
