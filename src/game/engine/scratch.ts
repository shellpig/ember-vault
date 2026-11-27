import * as THREE from 'three';

// Module-scoped scratch vectors for zero GC churn in render loop
export const _projVec = new THREE.Vector3();

export const _camTarget = new THREE.Vector3();

export const _camGoal = new THREE.Vector3();

export const _mat4 = new THREE.Matrix4();

export const _quat = new THREE.Quaternion();

export const _scale = new THREE.Vector3();

export const _pos = new THREE.Vector3();

export const _upAxis = new THREE.Vector3(0, 1, 0);

export const _color = new THREE.Color();
