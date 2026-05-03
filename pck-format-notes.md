Fileformat info based on https://github.com/DmitriySalnikov/GodotPCKExplorer

sts2 pck version: 3.4.5.1, flags: 2

Standalone files PCK begin with the magic: 47 44 50 43 (in ASCII: GDPC)

This is followed by 4 int32s representing the archive version:

PACK.MAJOR.MINOR.REVISION
(I'll be calling "revision" as "patch")

Then another int32 called "flags"
Followed by int64 "fileBase" which appears to be offset of file data from the beginning of the file
And then "IndexBase" which is offset to file index

so far we have:

```c
struct PckHeader {
    u32 magic; // ASCII GDPC
    u32 packVersion;
    u32 majorVersion;
    u32 minorVersion;
    u32 patchVersion;
    u32 flags;
    u64 dataOffset; // "FileBase"
    u64 indexOffset; // "IndexBase"
}
```

Index structures:

```c

struct PckFileIndex {
    u32 entryCount;
    struct PckFileIndexEntry entries[entryCount];
};

struct PckFileIndexEntry {
    u32 pathLength; // Path is null-padded to multiple of 4, pathLength includes the padding
    char path[pathLength];
    u64 dataOffset; // This is relative to dataOffset from pck header
    u64 size;
    uchar md5Hash[16];
    u32 flags;
};
```

...and it seems like the data isn't even compressed? So this is really simple
(there is optional encryption but sts2 doesn't use it; therefore, I don't care)
