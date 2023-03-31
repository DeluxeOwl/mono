use super::data;
use base64::prelude::*;
use image::{DynamicImage, ImageFormat};
extern crate lazy_static;

pub fn precompute() {
    _ = SPLATTER_0;
    _ = SPLATTER_1;
    _ = SPLATTER_2;
    _ = SPLATTER_3;
}

pub struct SplatterImages {
    pub i_0: DynamicImage,
    pub i_1: DynamicImage,
    pub i_2: DynamicImage,
    pub i_3: DynamicImage,
}

impl SplatterImages {
    pub fn to_arr(&self) -> [&DynamicImage; 4] {
        return [&self.i_0, &self.i_1, &self.i_2, &self.i_3];
    }
}

pub struct Splatter {
    pub frames_r: [&'static DynamicImage; 4],
    pub frames_l: [&'static DynamicImage; 4],
}

pub enum SplatterSize {
    Regular = 0,
    Large = 1,
}

fn get_frames(splatter_num: u8, size: SplatterSize) -> [&'static DynamicImage; 4] {
    match splatter_num {
        1 => match size {
            SplatterSize::Regular => IMAGES_0_REGULAR.to_arr(),
            SplatterSize::Large => IMAGES_0_LARGE.to_arr(),
        },
        2 => match size {
            SplatterSize::Regular => IMAGES_1_REGULAR.to_arr(),
            SplatterSize::Large => IMAGES_1_LARGE.to_arr(),
        },
        3 => match size {
            SplatterSize::Regular => IMAGES_2_REGULAR.to_arr(),
            SplatterSize::Large => IMAGES_2_LARGE.to_arr(),
        },
        _ => match size {
            SplatterSize::Regular => IMAGES_3_REGULAR.to_arr(),
            SplatterSize::Large => IMAGES_3_LARGE.to_arr(),
        },
    }
}

impl Splatter {
    pub fn num(num: u8) -> Splatter {
        Splatter {
            frames_r: get_frames(num, SplatterSize::Regular),
            frames_l: get_frames(num, SplatterSize::Large),
        }
    }
    pub fn at(&self, x: f32, y: f32, size: &SplatterSize) -> (i64, i64) {
        let half = match size {
            SplatterSize::Regular => 120.0,
            SplatterSize::Large => 200.0,
        };
        ((x - half).floor() as i64, (y - half).floor() as i64)
    }
    pub fn frame(&self, frame: usize, size: &SplatterSize) -> &DynamicImage {
        let frames = match size {
            SplatterSize::Regular => &self.frames_r,
            SplatterSize::Large => &self.frames_l,
        };
        if let Some(img) = frames.get(frame) {
            img
        } else {
            frames.last().unwrap()
        }
    }
}

fn image_from_str(string: &str) -> DynamicImage {
    let data = BASE64_STANDARD_NO_PAD
        .decode(string)
        .expect("Bad splatter image");
    image::load_from_memory_with_format(&data, ImageFormat::Png).unwrap()
}

pub fn for_index(
    index: usize,
    frame: usize,
    size: SplatterSize,
    x: f32,
    y: f32,
) -> (&'static DynamicImage, (i64, i64)) {
    match index {
        1 => (SPLATTER_1.frame(frame, &size), SPLATTER_1.at(x, y, &size)),
        2 => (SPLATTER_2.frame(frame, &size), SPLATTER_2.at(x, y, &size)),
        3 => (SPLATTER_3.frame(frame, &size), SPLATTER_3.at(x, y, &size)),
        _ => (SPLATTER_0.frame(frame, &size), SPLATTER_0.at(x, y, &size)),
    }
}

lazy_static! {
    pub static ref SPLATTER_0: Splatter = Splatter::num(0);
    pub static ref SPLATTER_1: Splatter = Splatter::num(1);
    pub static ref SPLATTER_2: Splatter = Splatter::num(2);
    pub static ref SPLATTER_3: Splatter = Splatter::num(3);
    pub static ref IMAGES_0_REGULAR: SplatterImages = SplatterImages {
        i_0: image_from_str(&data::SPLATTER_0_DATA_REGULAR[0]),
        i_1: image_from_str(&data::SPLATTER_0_DATA_REGULAR[1]),
        i_2: image_from_str(&data::SPLATTER_0_DATA_REGULAR[2]),
        i_3: image_from_str(&data::SPLATTER_0_DATA_REGULAR[3])
    };
    pub static ref IMAGES_1_REGULAR: SplatterImages = SplatterImages {
        i_0: image_from_str(&data::SPLATTER_1_DATA_REGULAR[0]),
        i_1: image_from_str(&data::SPLATTER_1_DATA_REGULAR[1]),
        i_2: image_from_str(&data::SPLATTER_1_DATA_REGULAR[2]),
        i_3: image_from_str(&data::SPLATTER_1_DATA_REGULAR[3])
    };
    pub static ref IMAGES_2_REGULAR: SplatterImages = SplatterImages {
        i_0: image_from_str(&data::SPLATTER_2_DATA_REGULAR[0]),
        i_1: image_from_str(&data::SPLATTER_2_DATA_REGULAR[1]),
        i_2: image_from_str(&data::SPLATTER_2_DATA_REGULAR[2]),
        i_3: image_from_str(&data::SPLATTER_2_DATA_REGULAR[3])
    };
    pub static ref IMAGES_3_REGULAR: SplatterImages = SplatterImages {
        i_0: image_from_str(&data::SPLATTER_3_DATA_REGULAR[0]),
        i_1: image_from_str(&data::SPLATTER_3_DATA_REGULAR[1]),
        i_2: image_from_str(&data::SPLATTER_3_DATA_REGULAR[2]),
        i_3: image_from_str(&data::SPLATTER_3_DATA_REGULAR[3])
    };
    pub static ref IMAGES_0_LARGE: SplatterImages = SplatterImages {
        i_0: image_from_str(&data::SPLATTER_0_DATA_LARGE[0]),
        i_1: image_from_str(&data::SPLATTER_0_DATA_LARGE[1]),
        i_2: image_from_str(&data::SPLATTER_0_DATA_LARGE[2]),
        i_3: image_from_str(&data::SPLATTER_0_DATA_LARGE[3])
    };
    pub static ref IMAGES_1_LARGE: SplatterImages = SplatterImages {
        i_0: image_from_str(&data::SPLATTER_1_DATA_LARGE[0]),
        i_1: image_from_str(&data::SPLATTER_1_DATA_LARGE[1]),
        i_2: image_from_str(&data::SPLATTER_1_DATA_LARGE[2]),
        i_3: image_from_str(&data::SPLATTER_1_DATA_LARGE[3])
    };
    pub static ref IMAGES_2_LARGE: SplatterImages = SplatterImages {
        i_0: image_from_str(&data::SPLATTER_2_DATA_LARGE[0]),
        i_1: image_from_str(&data::SPLATTER_2_DATA_LARGE[1]),
        i_2: image_from_str(&data::SPLATTER_2_DATA_LARGE[2]),
        i_3: image_from_str(&data::SPLATTER_2_DATA_LARGE[3])
    };
    pub static ref IMAGES_3_LARGE: SplatterImages = SplatterImages {
        i_0: image_from_str(&data::SPLATTER_3_DATA_LARGE[0]),
        i_1: image_from_str(&data::SPLATTER_3_DATA_LARGE[1]),
        i_2: image_from_str(&data::SPLATTER_3_DATA_LARGE[2]),
        i_3: image_from_str(&data::SPLATTER_3_DATA_LARGE[3])
    };
}
