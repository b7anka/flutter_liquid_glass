// Shape array uniforms - 6 floats per shape (type, centerX, centerY, sizeW, sizeH, cornerRadius)
// Reduced from 64 to 16 shapes to fit Impeller's uniform buffer limit (16 * 6 = 96 floats vs 384)
#ifndef MAX_SHAPES
#define MAX_SHAPES 16
#endif

float sdfRRect( in vec2 p, in vec2 b, in float r ) {
    float shortest = min(b.x, b.y);
    r = min(r, shortest);
    vec2 q = abs(p)-b+r;
    return min(max(q.x,q.y),0.0) + length(max(q,0.0)) - r;
}

float sdfRect(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdfSquircle(vec2 p, vec2 b, float r) {
    float shortest = min(b.x, b.y);
    r = min(r, shortest);

    vec2 q = abs(p) - b + r;
    
    vec2 maxQ = max(q, 0.0);
    return min(max(q.x, q.y), 0.0) + sqrt(maxQ.x * maxQ.x + maxQ.y * maxQ.y) - r;
}

float sdfEllipse(vec2 p, vec2 r) {
    r = max(r, 1e-4);
    
    vec2 invR = 1.0 / r;
    vec2 invR2 = invR * invR;
    
    vec2 pInvR = p * invR;
    float k1 = length(pInvR);
    
    vec2 pInvR2 = p * invR2;
    float k2 = length(pInvR2);
    
    return (k1 * (k1 - 1.0)) / max(k2, 1e-4);
}

float smoothUnion(float d1, float d2, float k) {
    if (k <= 0.0) {
        return min(d1, d2);
    }
    float e = max(k - abs(d1 - d2), 0.0);
    return min(d1, d2) - e * e * 0.25 / k;
}

float getShapeSDF(float type, vec2 p, vec2 center, vec2 size, float r) {
    if (type == 1.0) { // squircle
        return sdfSquircle(p - center, size / 2.0, r);
    }
    if (type == 2.0) { // ellipse
        return sdfEllipse(p - center, size / 2.0);
    }
    if (type == 3.0) { // rounded rectangle
        return sdfRRect(p - center, size / 2.0, r);
    }
    return 1e9; // none
}

// NOTE: SHAPE_DATA must be defined by the including shader before including this file.
// Example: #define SHAPE_DATA uShapeData
// This avoids passing the array as a function parameter, which is incompatible with SkSL.
// Using a macro ensures indices are compile-time constants (required by SkSL).
#define _SDF_AT(i, pt) getShapeSDF( \
    SHAPE_DATA[(i)*6], (pt), \
    vec2(SHAPE_DATA[(i)*6+1], SHAPE_DATA[(i)*6+2]), \
    vec2(SHAPE_DATA[(i)*6+3], SHAPE_DATA[(i)*6+4]), \
    SHAPE_DATA[(i)*6+5])

float sceneSDF(vec2 p, int numShapes, float blend) {
    if (numShapes == 0) {
        return 1e9;
    }
    
    float result = _SDF_AT(0, p);

    // Fully unrolled for all 16 shapes.
    // Both the loop-bound and all array indices are constant expressions – required by SkSL.
    if (numShapes >= 2)  { result = smoothUnion(result, _SDF_AT(1,  p), blend); }
    if (numShapes >= 3)  { result = smoothUnion(result, _SDF_AT(2,  p), blend); }
    if (numShapes >= 4)  { result = smoothUnion(result, _SDF_AT(3,  p), blend); }
    if (numShapes >= 5)  { result = smoothUnion(result, _SDF_AT(4,  p), blend); }
    if (numShapes >= 6)  { result = smoothUnion(result, _SDF_AT(5,  p), blend); }
    if (numShapes >= 7)  { result = smoothUnion(result, _SDF_AT(6,  p), blend); }
    if (numShapes >= 8)  { result = smoothUnion(result, _SDF_AT(7,  p), blend); }
    if (numShapes >= 9)  { result = smoothUnion(result, _SDF_AT(8,  p), blend); }
    if (numShapes >= 10) { result = smoothUnion(result, _SDF_AT(9,  p), blend); }
    if (numShapes >= 11) { result = smoothUnion(result, _SDF_AT(10, p), blend); }
    if (numShapes >= 12) { result = smoothUnion(result, _SDF_AT(11, p), blend); }
    if (numShapes >= 13) { result = smoothUnion(result, _SDF_AT(12, p), blend); }
    if (numShapes >= 14) { result = smoothUnion(result, _SDF_AT(13, p), blend); }
    if (numShapes >= 15) { result = smoothUnion(result, _SDF_AT(14, p), blend); }
    if (numShapes >= 16) { result = smoothUnion(result, _SDF_AT(15, p), blend); }

    return result;
}

// Calculate 3D normal using derivatives (shader-specific normal calculation)
// dFdx/dFdy are not available in SkSL runtime effects (web). On non-native targets we
// return a flat up-normal so the shader still compiles; at runtime the kIsWeb guard in
// Dart prevents this code path from being reached on web.
vec3 getNormal(float sd, float thickness) {
#if defined(IMPELLER_TARGET_METAL) || defined(IMPELLER_TARGET_OPENGLES) || defined(IMPELLER_TARGET_VULKAN)
    float dx = dFdx(sd);
    float dy = dFdy(sd);
    float n_cos = max(thickness + sd, 0.0) / thickness;
    float n_sin = sqrt(max(0.0, 1.0 - n_cos * n_cos));
    return normalize(vec3(dx * n_cos, dy * n_cos, n_sin));
#else
    // SkSL web fallback – never executed thanks to kIsWeb Dart guard.
    float n_cos = max(thickness + sd, 0.0) / thickness;
    float n_sin = sqrt(max(0.0, 1.0 - n_cos * n_cos));
    return normalize(vec3(0.0, 0.0, 1.0));
#endif
}
