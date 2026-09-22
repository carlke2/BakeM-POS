using System;
using System.Collections.Generic;
using System.Threading;
using libzkfpcsharp;

sealed class FingerprintDevice : IDisposable
{
    private IntPtr _device = IntPtr.Zero;
    private IntPtr _dbHandle = IntPtr.Zero;
    private bool _initialized;
    private readonly object _lock = new();

    public bool IsReady => _initialized && _device != IntPtr.Zero;

    public int DeviceCount { get; private set; }

    public string? LastError { get; private set; }

    public bool Initialize()
    {
        lock (_lock)
        {
            if (_initialized) return IsReady;

            int ret = zkfp2.Init();
            if (ret != zkfperrdef.ZKFP_ERR_OK)
            {
                LastError = "Failed to initialize fingerprint SDK";
                return false;
            }

            _initialized = true;
            DeviceCount = zkfp2.GetDeviceCount();

            if (DeviceCount <= 0)
            {
                LastError = "No fingerprint scanner detected";
                return false;
            }

            _device = zkfp2.OpenDevice(0);
            if (_device == IntPtr.Zero)
            {
                LastError = "Failed to open fingerprint scanner";
                return false;
            }

            // Warm matcher now so first duplicate check is not delayed
            _ = GetDbHandle();

            LastError = null;
            return true;
        }
    }

    private IntPtr GetDbHandle()
    {
        if (_dbHandle == IntPtr.Zero)
        {
            if (!_initialized && !Initialize())
                throw new InvalidOperationException(LastError ?? "Scanner not initialized");

            _dbHandle = zkfp2.DBInit();
            if (_dbHandle == IntPtr.Zero)
                throw new InvalidOperationException("Failed to initialize fingerprint matcher");
        }

        return _dbHandle;
    }

    /// <summary>Wakes the device so the next capture starts faster.</summary>
    public bool Prepare()
    {
        lock (_lock)
        {
            if (!IsReady && !Initialize())
                return false;

            byte[] fpImage = new byte[1024 * 1024];
            byte[] fpTemplate = new byte[2048];
            int size = 2048;
            zkfp2.AcquireFingerprint(_device, fpImage, fpTemplate, ref size);
            LastError = null;
            return true;
        }
    }

    public (byte[] template, int size)? Capture(TimeSpan timeout)
    {
        lock (_lock)
        {
            if (!IsReady && !Initialize())
                return null;

            byte[] fpImage = new byte[1024 * 1024];
            byte[] fpTemplate = new byte[2048];
            int size = 2048;
            var deadline = DateTime.UtcNow.Add(timeout);

            while (DateTime.UtcNow < deadline)
            {
                size = 2048;
                int result = zkfp2.AcquireFingerprint(_device, fpImage, fpTemplate, ref size);
                if (result == zkfperrdef.ZKFP_ERR_OK && size > 0)
                {
                    var template = new byte[size];
                    Array.Copy(fpTemplate, template, size);
                    LastError = null;
                    return (template, size);
                }

                Thread.Sleep(20);
            }

            LastError = "Timed out waiting for fingerprint";
            return null;
        }
    }

    /// <summary>
    /// Compare candidate against existing templates using ZKTeco DBMatch (score &gt; 0 = same finger).
    /// </summary>
    public (bool isDuplicate, int matchedIndex, int score) FindDuplicate(byte[] candidate, IReadOnlyList<byte[]> existing)
    {
        lock (_lock)
        {
            if (existing.Count == 0)
                return (false, -1, 0);

            IntPtr db = GetDbHandle();

            for (int i = 0; i < existing.Count; i++)
            {
                int score = zkfp2.DBMatch(db, candidate, existing[i]);
                if (score > 0)
                    return (true, i, score);
            }

            return (false, -1, 0);
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_dbHandle != IntPtr.Zero)
            {
                zkfp2.DBFree(_dbHandle);
                _dbHandle = IntPtr.Zero;
            }

            if (_device != IntPtr.Zero)
            {
                zkfp2.CloseDevice(_device);
                _device = IntPtr.Zero;
            }

            if (_initialized)
            {
                zkfp2.Terminate();
                _initialized = false;
            }
        }
    }
}
