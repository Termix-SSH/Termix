export const SFTP_XFER_SEGMENT_SIZE = 256 * 1024 * 1024;
export const DEFAULT_PARALLEL_SEGMENT_COUNT = 2;
export const MAX_PARALLEL_SEGMENT_COUNT = 8;

export interface SegmentCopyJob {
  offset: number;
  length: number;
  segmentIndex: number;
}

export function clampParallelSegmentCount(value?: number): number {
  const n = value ?? DEFAULT_PARALLEL_SEGMENT_COUNT;
  return Math.max(1, Math.min(MAX_PARALLEL_SEGMENT_COUNT, Math.floor(n)));
}

export function buildSegmentCopyJobs(
  fileSize: number,
  initialOffset: number,
  destResumeSize: number,
): SegmentCopyJob[] {
  const jobs: SegmentCopyJob[] = [];
  for (
    let offset = initialOffset;
    offset < fileSize;
    offset += SFTP_XFER_SEGMENT_SIZE
  ) {
    const length = Math.min(SFTP_XFER_SEGMENT_SIZE, fileSize - offset);
    const segmentIndex = Math.floor(offset / SFTP_XFER_SEGMENT_SIZE);
    if (destResumeSize >= offset + length) {
      continue;
    }
    const start = destResumeSize > offset ? destResumeSize : offset;
    jobs.push({
      offset: start,
      length: offset + length - start,
      segmentIndex,
    });
  }
  return jobs;
}
