import fs from 'node:fs/promises';

// This function is used to override chmod 
// permissions which are not granted by 
// attached to Docker container Azure File Storage.
// Unlike fs.cp it does not require chmod permissions.
export async function recursiveCopyFiles(srcDir: string, destDir: string) {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = `${srcDir}/${entry.name}`;
        const destPath = `${destDir}/${entry.name}`;
        if (entry.isDirectory()) {
            await fs.mkdir(destPath, { recursive: true });
            await recursiveCopyFiles(srcPath, destPath); // Recurse for nested directories
        } else if (entry.isFile()) {
            await fs.copyFile(srcPath, destPath);
        }
    }
  }