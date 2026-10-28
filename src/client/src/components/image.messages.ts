import { message } from "../localization/service";

export default {
  show: message("Show image", "Load an outside-workspace image after explicit user approval"),
  loadingDisabled: message("Image loading disabled", "Image placeholder when image loading is disabled in chat preferences"),
  attachedImage: message("attached image", "Default alternative text for a transcript attachment with no caller-provided description"),
  unavailable: message("Image unavailable", "Attached image placeholder when no authorized source is available"),
  enlarge: message<{ description: string }>("Enlarge {description}", "Accessible name for enlarging an image; description is unchanged caller-supplied alt text"),
  enlargeImage: message("Enlarge image", "Accessible name for enlarging an image without a description"),
  enlargeHint: message("Click to enlarge", "Tooltip on an image enlargement button"),
  preview: message("Image preview", "Accessible name of the image gallery dialog"),
  position: message<{ index: number; count: number }>("Image {index, number} of {count, number}", "Live gallery position, with one-based index and total image count"),
  close: message("Close image", "Close the image gallery"),
  previous: message("Previous", "Gallery button to show the previous image"),
  previousImage: message("Previous image", "Accessible name for the previous-image gallery button"),
  next: message("Next", "Gallery button to show the next image"),
  nextImage: message("Next image", "Accessible name for the next-image gallery button"),
};
