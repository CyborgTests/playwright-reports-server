export interface StorageConfig {
  type: 'fs' | 's3' | 'azure';
  basePath?: string;
  endpoint?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
}

export const getStorageConfig = (): StorageConfig => {
  return {
    type: 'fs',
    basePath: '/data',
  };
};
