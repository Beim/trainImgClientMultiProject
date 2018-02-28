#!/bin/bash

TOOLS=/opt/caffe/tools
RESIZE_HEIGHT=224
RESIZE_WIDTH=224
TRAIN_LABEL=$1 # train.txt
VAL_LABEL=$2 # val.txt
LMDB_ROOT=$3

echo "Creating train lmdb ..."

GLOG_logtostderr=1 $TOOLS/convert_imageset \
	--resize_height=$RESIZE_HEIGHT \
	--resize_width=$RESIZE_WIDTH \
	--shuffle \
	/ \
	$TRAIN_LABEL \
	$LMDB_ROOT/train_lmdb

echo "Creating val lmdb..."

GLOG_logtostderr=1 $TOOLS/convert_imageset \
	--resize_height=$RESIZE_HEIGHT \
	--resize_width=$RESIZE_WIDTH \
	--shuffle \
	/ \
	$VAL_LABEL \
	$LMDB_ROOT/val_lmdb

echo "Down..."
