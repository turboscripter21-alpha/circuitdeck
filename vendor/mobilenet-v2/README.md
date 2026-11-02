# MobileNet V2 (alpha 0.35, 224×224, no top), TF.js layers model
These are the same weights Google's Teachable Machine uses, from
https://storage.googleapis.com/teachable-machine-models/mobilenet_v2_weights_tf_dim_ordering_tf_kernels_0.35_224_no_top/
They're the Keras Applications MobileNetV2 ImageNet weights (Apache-2.0). The Train panel freezes this network
and only trains a small dense head on its pooled 1280-value output.
