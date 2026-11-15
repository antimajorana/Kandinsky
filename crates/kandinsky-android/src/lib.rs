//! Kandinsky on the phone (docs/guides/ANDROID.md): the screen is Java (android/java/), what a capture means is the desktop
//! box's own code (kandinsky-capture without its window, kandinsky-core). `phone` holds plain functions, tested here;
//! `glue` hands them to Java through JNI as strings (JSON for structures), so the Java side stays thin.
pub mod phone;
pub mod text;
pub mod image;
pub mod ink;
pub use kandinsky_core::pdfium; // PDFium is the core's (covers on every platform); the phone loads it from the APK
pub use kandinsky_pen::{arrow, regular, shape, shape_openink}; // the recognisers live in kandinsky-pen (the core uses them too)
#[cfg(feature = "full")]
pub mod serve;

#[cfg(target_os = "android")]
mod glue;
#[cfg(target_os = "android")]
mod pen_reader;
#[cfg(all(target_os = "android", feature = "full"))]
mod notices;
