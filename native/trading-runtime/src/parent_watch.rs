//! Watch an inherited parent-owned pipe so abrupt parent loss stops native work.
#[cfg(unix)]
pub fn start() -> std::io::Result<()> {
    use std::fs::File;
    use std::io::{self, Read};
    use std::os::fd::FromRawFd;

    const FD: libc::c_int = 3;
    // SAFETY: startup is single-threaded; fd3 is exclusively reserved by the
    // command-line contract. Validate it before taking ownership below.
    let descriptor_flags = unsafe { libc::fcntl(FD, libc::F_GETFD) };
    if descriptor_flags == -1 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the validated descriptor remains open during startup.
    if unsafe { libc::fcntl(FD, libc::F_SETFD, descriptor_flags | libc::FD_CLOEXEC) } == -1 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the same validated descriptor is still exclusively owned here.
    let status_flags = unsafe { libc::fcntl(FD, libc::F_GETFL) };
    if status_flags == -1 {
        return Err(io::Error::last_os_error());
    }
    // The watchdog must block, including when the parent supplied a socketpair.
    // SAFETY: this changes flags on the validated, exclusively owned descriptor.
    if unsafe { libc::fcntl(FD, libc::F_SETFL, status_flags & !libc::O_NONBLOCK) } == -1 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: fd3 is open, uniquely owned, and ownership transfers to this File.
    let mut pipe = unsafe { File::from_raw_fd(FD) };
    std::thread::Builder::new()
        .name("parent-watch".to_owned())
        .spawn(move || {
            let mut byte = [0_u8; 1];
            loop {
                match pipe.read(&mut byte) {
                    Ok(0) => std::process::exit(130),
                    Ok(_) => {}
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    Err(_) => std::process::exit(130),
                }
            }
        })?;
    Ok(())
}

#[cfg(not(unix))]
pub fn start() -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Parent watchdog requires Unix",
    ))
}
