import crypto from 'crypto';
import os from 'os';
import { execSync } from 'child_process';
import fs from 'fs';
import { databaseLogger } from './logger.js';

interface HardwareInfo {
  cpuId?: string;
  motherboardUuid?: string;
  diskSerial?: string;
  biosSerial?: string;
  tpmInfo?: string;
  macAddresses?: string[];
}

/**
 * 硬件指纹生成器 - 使用真实硬件特征生成稳定的设备指纹
 * 相比软件环境指纹，硬件指纹在虚拟化和容器环境中更加稳定
 */
class HardwareFingerprint {
  private static readonly CACHE_KEY = 'cached_hardware_fingerprint';
  private static cachedFingerprint: string | null = null;

  /**
   * 生成硬件指纹
   * 优先级：缓存 > 环境变量 > 硬件检测
   */
  static generate(): string {
    try {
      // 1. 检查缓存
      if (this.cachedFingerprint) {
        return this.cachedFingerprint;
      }

      // 2. 检查环境变量覆盖
      const envFingerprint = process.env.TERMIX_HARDWARE_SEED;
      if (envFingerprint && envFingerprint.length >= 32) {
        databaseLogger.info('Using hardware seed from environment variable', {
          operation: 'hardware_fingerprint_env'
        });
        this.cachedFingerprint = this.hashFingerprint(envFingerprint);
        return this.cachedFingerprint;
      }

      // 3. 检测真实硬件信息
      const hwInfo = this.detectHardwareInfo();
      const fingerprint = this.generateFromHardware(hwInfo);

      this.cachedFingerprint = fingerprint;

      databaseLogger.info('Generated hardware fingerprint', {
        operation: 'hardware_fingerprint_generation',
        fingerprintPrefix: fingerprint.substring(0, 8),
        detectedComponents: Object.keys(hwInfo).filter(key => hwInfo[key as keyof HardwareInfo])
      });

      return fingerprint;
    } catch (error) {
      databaseLogger.error('Hardware fingerprint generation failed', error, {
        operation: 'hardware_fingerprint_failed'
      });

      // 回退到基本的环境指纹
      return this.generateFallbackFingerprint();
    }
  }

  /**
   * 检测硬件信息
   */
  private static detectHardwareInfo(): HardwareInfo {
    const platform = os.platform();
    const hwInfo: HardwareInfo = {};

    try {
      switch (platform) {
        case 'linux':
          hwInfo.cpuId = this.getLinuxCpuId();
          hwInfo.motherboardUuid = this.getLinuxMotherboardUuid();
          hwInfo.diskSerial = this.getLinuxDiskSerial();
          hwInfo.biosSerial = this.getLinuxBiosSerial();
          break;

        case 'win32':
          hwInfo.cpuId = this.getWindowsCpuId();
          hwInfo.motherboardUuid = this.getWindowsMotherboardUuid();
          hwInfo.diskSerial = this.getWindowsDiskSerial();
          hwInfo.biosSerial = this.getWindowsBiosSerial();
          break;

        case 'darwin':
          hwInfo.cpuId = this.getMacOSCpuId();
          hwInfo.motherboardUuid = this.getMacOSMotherboardUuid();
          hwInfo.diskSerial = this.getMacOSDiskSerial();
          hwInfo.biosSerial = this.getMacOSBiosSerial();
          break;
      }

      // 所有平台都尝试获取MAC地址
      hwInfo.macAddresses = this.getStableMacAddresses();

    } catch (error) {
      databaseLogger.error('Some hardware detection failed', error, {
        operation: 'hardware_detection_partial_failure',
        platform
      });
    }

    return hwInfo;
  }

  /**
   * Linux平台硬件信息获取
   */
  private static getLinuxCpuId(): string | undefined {
    try {
      // 尝试多种方法获取CPU信息
      const methods = [
        () => fs.readFileSync('/proc/cpuinfo', 'utf8').match(/processor\s*:\s*(\d+)/)?.[1],
        () => execSync('dmidecode -t processor | grep "ID:" | head -1', { encoding: 'utf8' }).trim(),
        () => execSync('cat /proc/cpuinfo | grep "cpu family\\|model\\|stepping" | md5sum', { encoding: 'utf8' }).split(' ')[0]
      ];

      for (const method of methods) {
        try {
          const result = method();
          if (result && result.length > 0) return result;
        } catch { /* 继续尝试下一种方法 */ }
      }
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getLinuxMotherboardUuid(): string | undefined {
    try {
      // 尝试多种方法获取主板UUID
      const methods = [
        () => fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8').trim(),
        () => fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
        () => execSync('dmidecode -s system-uuid', { encoding: 'utf8' }).trim()
      ];

      for (const method of methods) {
        try {
          const result = method();
          if (result && result.length > 0 && result !== 'Not Settable') return result;
        } catch { /* 继续尝试下一种方法 */ }
      }
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getLinuxDiskSerial(): string | undefined {
    try {
      // 获取根分区所在磁盘的序列号
      const rootDisk = execSync("df / | tail -1 | awk '{print $1}' | sed 's/[0-9]*$//'", { encoding: 'utf8' }).trim();
      if (rootDisk) {
        const serial = execSync(`udevadm info --name=${rootDisk} | grep ID_SERIAL= | cut -d= -f2`, { encoding: 'utf8' }).trim();
        if (serial && serial.length > 0) return serial;
      }
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getLinuxBiosSerial(): string | undefined {
    try {
      const methods = [
        () => fs.readFileSync('/sys/class/dmi/id/board_serial', 'utf8').trim(),
        () => execSync('dmidecode -s baseboard-serial-number', { encoding: 'utf8' }).trim()
      ];

      for (const method of methods) {
        try {
          const result = method();
          if (result && result.length > 0 && result !== 'Not Specified') return result;
        } catch { /* 继续尝试下一种方法 */ }
      }
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  /**
   * Windows平台硬件信息获取
   */
  private static getWindowsCpuId(): string | undefined {
    try {
      const result = execSync('wmic cpu get ProcessorId /value', { encoding: 'utf8' });
      const match = result.match(/ProcessorId=(.+)/);
      return match?.[1]?.trim();
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getWindowsMotherboardUuid(): string | undefined {
    try {
      const result = execSync('wmic csproduct get UUID /value', { encoding: 'utf8' });
      const match = result.match(/UUID=(.+)/);
      return match?.[1]?.trim();
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getWindowsDiskSerial(): string | undefined {
    try {
      const result = execSync('wmic diskdrive get SerialNumber /value', { encoding: 'utf8' });
      const match = result.match(/SerialNumber=(.+)/);
      return match?.[1]?.trim();
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getWindowsBiosSerial(): string | undefined {
    try {
      const result = execSync('wmic baseboard get SerialNumber /value', { encoding: 'utf8' });
      const match = result.match(/SerialNumber=(.+)/);
      return match?.[1]?.trim();
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  /**
   * macOS平台硬件信息获取
   */
  private static getMacOSCpuId(): string | undefined {
    try {
      const result = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf8' });
      return result.trim();
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getMacOSMotherboardUuid(): string | undefined {
    try {
      const result = execSync('system_profiler SPHardwareDataType | grep "Hardware UUID"', { encoding: 'utf8' });
      const match = result.match(/Hardware UUID:\s*(.+)/);
      return match?.[1]?.trim();
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getMacOSDiskSerial(): string | undefined {
    try {
      const result = execSync('system_profiler SPStorageDataType | grep "Serial Number"', { encoding: 'utf8' });
      const match = result.match(/Serial Number:\s*(.+)/);
      return match?.[1]?.trim();
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  private static getMacOSBiosSerial(): string | undefined {
    try {
      const result = execSync('system_profiler SPHardwareDataType | grep "Serial Number"', { encoding: 'utf8' });
      const match = result.match(/Serial Number \(system\):\s*(.+)/);
      return match?.[1]?.trim();
    } catch { /* 忽略错误 */ }
    return undefined;
  }

  /**
   * 获取稳定的MAC地址
   * 排除虚拟接口和临时接口
   */
  private static getStableMacAddresses(): string[] {
    try {
      const networkInterfaces = os.networkInterfaces();
      const macAddresses: string[] = [];

      for (const [interfaceName, interfaces] of Object.entries(networkInterfaces)) {
        if (!interfaces) continue;

        // 排除虚拟接口和Docker接口
        if (interfaceName.match(/^(lo|docker|veth|br-|virbr)/)) continue;

        for (const iface of interfaces) {
          if (!iface.internal &&
              iface.mac &&
              iface.mac !== '00:00:00:00:00:00' &&
              !iface.mac.startsWith('02:42:')) { // Docker接口特征
            macAddresses.push(iface.mac);
          }
        }
      }

      return macAddresses.sort(); // 排序确保一致性
    } catch {
      return [];
    }
  }

  /**
   * 从硬件信息生成指纹
   */
  private static generateFromHardware(hwInfo: HardwareInfo): string {
    const components = [
      hwInfo.motherboardUuid,  // 最稳定的标识符
      hwInfo.cpuId,
      hwInfo.biosSerial,
      hwInfo.diskSerial,
      hwInfo.macAddresses?.join(','),
      os.platform(),          // 操作系统平台
      os.arch()              // CPU架构
    ].filter(Boolean); // 过滤空值

    if (components.length === 0) {
      throw new Error('No hardware identifiers found');
    }

    return this.hashFingerprint(components.join('|'));
  }

  /**
   * 生成回退指纹（当硬件检测失败时）
   */
  private static generateFallbackFingerprint(): string {
    const fallbackComponents = [
      os.hostname(),
      os.platform(),
      os.arch(),
      process.cwd(),
      'fallback-mode'
    ];

    databaseLogger.warn('Using fallback fingerprint due to hardware detection failure', {
      operation: 'hardware_fingerprint_fallback'
    });

    return this.hashFingerprint(fallbackComponents.join('|'));
  }

  /**
   * 标准化指纹哈希
   */
  private static hashFingerprint(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * 获取硬件指纹信息（用于调试和显示）
   */
  static getHardwareInfo(): HardwareInfo & { fingerprint: string } {
    const hwInfo = this.detectHardwareInfo();
    return {
      ...hwInfo,
      fingerprint: this.generate().substring(0, 16)
    };
  }

  /**
   * 验证当前硬件指纹
   */
  static validateFingerprint(expectedFingerprint: string): boolean {
    try {
      const currentFingerprint = this.generate();
      return currentFingerprint === expectedFingerprint;
    } catch {
      return false;
    }
  }

  /**
   * 清除缓存（用于测试）
   */
  static clearCache(): void {
    this.cachedFingerprint = null;
  }
}

export { HardwareFingerprint };
export type { HardwareInfo };