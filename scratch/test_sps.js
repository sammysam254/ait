// Test H264 SPS parser with real-world scrcpy SPS samples
function parseH264SPS(bytes) {
  // Find SPS NAL unit (type 7)
  let spsData = null;
  for (let i = 0; i < bytes.length - 4; i++) {
    let start = -1;
    if (bytes[i] === 0 && bytes[i+1] === 0 && bytes[i+2] === 1) start = i + 3;
    else if (bytes[i] === 0 && bytes[i+1] === 0 && bytes[i+2] === 0 && bytes[i+3] === 1) start = i + 4;
    
    if (start !== -1 && start < bytes.length) {
      if ((bytes[start] & 0x1f) === 7) {
        let end = bytes.length;
        for (let j = start + 1; j < bytes.length - 3; j++) {
          if (bytes[j] === 0 && bytes[j+1] === 0 && (bytes[j+2] === 1 || (bytes[j+2] === 0 && bytes[j+3] === 1))) {
            end = j;
            break;
          }
        }
        spsData = bytes.subarray(start, end);
        break;
      }
    }
  }

  if (!spsData || spsData.length < 4) return null;

  try {
    // Strip emulation prevention bytes
    const rbsp = [];
    for (let i = 0; i < spsData.length; i++) {
      if (i + 2 < spsData.length && spsData[i] === 0 && spsData[i+1] === 0 && spsData[i+2] === 3) {
        rbsp.push(0);
        rbsp.push(0);
        i += 2;
      } else {
        rbsp.push(spsData[i]);
      }
    }
    const data = new Uint8Array(rbsp);
    let bitPos = 8; // skip 1-byte NAL header

    function readBits(num) {
      let val = 0;
      for (let i = 0; i < num; i++) {
        const byteIdx = bitPos >> 3;
        if (byteIdx >= data.length) return 0;
        const bitIdx = 7 - (bitPos & 7);
        val = (val << 1) | ((data[byteIdx] >> bitIdx) & 1);
        bitPos++;
      }
      return val;
    }

    function readUEG() {
      let zeros = 0;
      while (readBits(1) === 0 && zeros < 32) zeros++;
      return zeros === 0 ? 0 : ((1 << zeros) - 1) + readBits(zeros);
    }

    function skipEG() {
      const v = readUEG();
    }

    const profileIdc = readBits(8);
    readBits(5);
    readBits(3);
    readBits(8);
    readUEG(); // seq_parameter_set_id

    if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(profileIdc)) {
      const chroma = readUEG();
      if (chroma === 3) readBits(1);
      readUEG(); // bit_depth_luma
      readUEG(); // bit_depth_chroma
      readBits(1);
      if (readBits(1)) {
        const count = chroma !== 3 ? 8 : 12;
        for (let i = 0; i < count; i++) {
          if (readBits(1)) {
            const size = i < 6 ? 16 : 64;
            let last = 8, next = 8;
            for (let j = 0; j < size; j++) {
              if (next !== 0) {
                const delta = readUEG();
                next = (last + delta) & 0xff;
              }
              last = next === 0 ? last : next;
            }
          }
        }
      }
    }

    readUEG(); // log2_max_frame_num
    const picOrderType = readUEG();
    if (picOrderType === 0) {
      readUEG();
    } else if (picOrderType === 1) {
      readBits(1);
      skipEG();
      skipEG();
      const numRef = readUEG();
      for (let i = 0; i < numRef; i++) skipEG();
    }

    readUEG(); // max_num_ref_frames
    readBits(1); // gaps
    const picWidthMbs = readUEG();
    const picHeightUnits = readUEG();
    const frameMbsOnly = readBits(1);
    if (!frameMbsOnly) readBits(1);
    readBits(1); // direct 8x8

    let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
    if (readBits(1)) {
      cropLeft = readUEG();
      cropRight = readUEG();
      cropTop = readUEG();
      cropBottom = readUEG();
    }

    const width = ((picWidthMbs + 1) * 16) - (cropLeft + cropRight) * 2;
    const height = ((2 - frameMbsOnly) * (picHeightUnits + 1) * 16) - ((frameMbsOnly ? 2 : 4) * (cropTop + cropBottom));
    if (width > 0 && height > 0 && width <= 4096 && height <= 4096) {
      return { width, height };
    }
  } catch (e) {}
  return null;
}

// Test with 720x1600 synthetic SPS:
// NAL type 7 (0x67)
// profile 66 (baseline), constraint 0, level 31 (0x1f)
// seq_param 0 -> 1 (0)
// log2_max_frame_num 0 -> 1 (0)
// pic_order_cnt_type 0 -> 1 (0)
// max_pic_order_cnt 0 -> 1 (0)
// max_num_ref_frames 1 -> 010 (2)
// gaps 0
// pic_width_in_mbs_minus1 = 44 (720 / 16 - 1) -> UEG(44)
// pic_height_in_map_units_minus1 = 99 (1600 / 16 - 1) -> UEG(99)
// frame_mbs_only = 1
// direct_8x8 = 1
// frame_cropping = 0
console.log("parseH264SPS ready");
