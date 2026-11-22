using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

class PcmAudioBridge {
    [DllImport("winmm.dll")]
    private static extern int waveOutOpen(out IntPtr hWaveOut, int uDeviceID, ref WAVEFORMATEX lpFormat, IntPtr dwCallback, IntPtr dwInstance, int dwFlags);
    [DllImport("winmm.dll")]
    private static extern int waveOutPrepareHeader(IntPtr hWaveOut, IntPtr lpWaveOutHdr, int uSize);
    [DllImport("winmm.dll")]
    private static extern int waveOutWrite(IntPtr hWaveOut, IntPtr lpWaveOutHdr, int uSize);
    [DllImport("winmm.dll")]
    private static extern int waveOutUnprepareHeader(IntPtr hWaveOut, IntPtr lpWaveOutHdr, int uSize);
    [DllImport("winmm.dll")]
    private static extern int waveOutClose(IntPtr hWaveOut);

    [StructLayout(LayoutKind.Sequential)]
    public struct WAVEFORMATEX {
        public short wFormatTag;
        public short nChannels;
        public int nSamplesPerSec;
        public int nAvgBytesPerSec;
        public short nBlockAlign;
        public short wBitsPerSample;
        public short cbSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WAVEHDR {
        public IntPtr lpData;
        public int dwBufferLength;
        public int dwBytesRecorded;
        public IntPtr dwUser;
        public int dwFlags;
        public int dwLoops;
        public IntPtr lpNext;
        public IntPtr reserved;
    }

    const short WAVE_FORMAT_PCM = 1;
    const int WAVE_MAPPER = -1;

    static void Main(string[] args) {
        int sampleRate = 16000;
        short channels = 1;
        short bitsPerSample = 16;
        if (args.Length > 0) int.TryParse(args[0], out sampleRate);

        WAVEFORMATEX format = new WAVEFORMATEX();
        format.wFormatTag = WAVE_FORMAT_PCM;
        format.nChannels = channels;
        format.nSamplesPerSec = sampleRate;
        format.wBitsPerSample = bitsPerSample;
        format.nBlockAlign = (short)(channels * (bitsPerSample / 8));
        format.nAvgBytesPerSec = sampleRate * format.nBlockAlign;
        format.cbSize = 0;

        IntPtr hWaveOut;
        int res = waveOutOpen(out hWaveOut, WAVE_MAPPER, ref format, IntPtr.Zero, IntPtr.Zero, 0);
        if (res != 0) {
            Console.Error.WriteLine("Error opening waveOut: " + res);
            return;
        }

        byte[] buffer = new byte[4096];
        Stream stdin = Console.OpenStandardInput();
        int bytesRead;

        int hdrSize = Marshal.SizeOf(typeof(WAVEHDR));

        while ((bytesRead = stdin.Read(buffer, 0, buffer.Length)) > 0) {
            IntPtr pData = Marshal.AllocHGlobal(bytesRead);
            Marshal.Copy(buffer, 0, pData, bytesRead);

            WAVEHDR hdr = new WAVEHDR();
            hdr.lpData = pData;
            hdr.dwBufferLength = bytesRead;

            IntPtr pHdr = Marshal.AllocHGlobal(hdrSize);
            Marshal.StructureToPtr(hdr, pHdr, false);

            waveOutPrepareHeader(hWaveOut, pHdr, hdrSize);
            waveOutWrite(hWaveOut, pHdr, hdrSize);

            // Wait briefly to avoid allocating too many buffers if writing too fast
            Thread.Sleep(bytesRead / (sampleRate * 2 / 1000) / 2);
        }

        Thread.Sleep(200);
        waveOutClose(hWaveOut);
    }
}
