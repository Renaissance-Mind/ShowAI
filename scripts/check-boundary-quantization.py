#!/usr/bin/env python3
"""Independent high-precision regression oracle; it does not establish the
all-u proof (which is the exact-Q derivative/Bernstein bound in quantization.hpp).
Consumes the actual Native/WASM certificate output, never a mocked geometry.
"""
import json
import math
import os
from pathlib import Path
import mpmath as mp
mp.mp.dps = 200
root = Path(os.environ['SHOWAI_BOUNDARY_QUANTIZATION_OUTPUT'])
fixtures = json.loads((root / 'quantization-fixtures.json').read_text())
def rational(value):
    return mp.mpf(value['n']) / mp.mpf(value['d'])
def polynomial(coefficients, t):
    result = mp.mpf(0)
    for coefficient in reversed(coefficients):
        result = result * t + coefficient
    return result
def certified_root(record):
    lo, hi = rational(record['lower']), rational(record['upper'])
    coefficients = [rational(q) for q in record['coefficients']]
    if lo == hi:
        assert abs(polynomial(coefficients, lo)) == 0
        return lo
    # Actual square-free isolating certificates have a single simple root.
    left, right = polynomial(coefficients, lo), polynomial(coefficients, hi)
    assert left * right < 0, (lo, hi, left, right)
    for _ in range(700):
        middle = (lo + hi) / 2
        if middle == lo or middle == hi:
            break
        value = polynomial(coefficients, middle)
        if value == 0:
            return middle
        if left * value < 0:
            hi, right = middle, value
        else:
            lo, left = middle, value
    return (lo + hi) / 2

def bezier(points, t):
    points = list(points)
    while len(points) > 1:
        points = [(1-t)*a+t*b for a,b in zip(points,points[1:])]
    return points[0]

sampled = 0
maximum_ratio = mp.mpf(0)
by_fixture = []
for fixture in fixtures:
    if fixture.get('explicitGraphRangeBeforeQuantizer') or fixture.get('invalidParameterOrderRejected') or fixture.get('polynomialBudgetRejected'):
        continue
    origin = [mp.mpf(float(v)) for v in fixture['origin']]
    local_maximum = mp.mpf(0)
    for edge in fixture['edges']:
        a, b = certified_root(edge['a']), certified_root(edge['b'])
        assert a < b
        source = [[rational(p[axis]) for p in edge['sourceControls']] for axis in range(2)]
        derived = [[mp.mpf(float(edge['controls'][i*2+axis])) + origin[axis] for i in range(edge['degree']+1)] for axis in range(2)]
        bound = mp.mpf(float(edge['error']))
        assert bound <= mp.mpf(float(fixture['tolerance']))
        for index in range(1025):
            u = mp.mpf(index) / 1024
            t = a + (b-a)*u
            error = sum(abs(bezier(source[axis],t)-bezier(derived[axis],u)) for axis in range(2))
            # Only numerical oracle evaluation has a rounding allowance, at
            # precision200 far below any requested bound. No production bound
            # or acceptance tolerance is enlarged by this diagnostic allowance.
            assert error <= bound + mp.mpf('1e-170'), (fixture['id'], edge['edge'], index, error, bound)
            if bound:
                ratio = error/bound
                maximum_ratio = max(maximum_ratio,ratio)
                local_maximum = max(local_maximum,ratio)
            sampled += 1
    by_fixture.append({'fixture':fixture['id'],'edges':len(fixture['edges']),'maximumSampledErrorToCertifiedBound':float(local_maximum)})
result = {'independentOracle':'mpmath1.3.0, precision200 decimal digits, bracketed bisection from actual original exact polynomial certificates', 'sampleChecks':sampled, 'maximumSampledErrorToCertifiedBound':float(maximum_ratio), 'fixtures':by_fixture,'allUBoundSource':'Exact rational derivative/Bernstein convex-hull proof, not these samples','topologyPreservationClaim':False}
(root / 'quantization-oracle-results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
