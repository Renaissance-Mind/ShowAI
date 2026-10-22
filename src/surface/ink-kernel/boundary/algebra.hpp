#ifndef SHOWAI_BOUNDARY_ALGEBRA_HPP
#define SHOWAI_BOUNDARY_ALGEBRA_HPP
#include "polynomial.hpp"
namespace showai_boundary {
struct Point {Q x,y;Context*context()const{return x.context()?x.context():y.context();}};
inline Point operator+(const Point&a,const Point&b){return{a.x+b.x,a.y+b.y};}inline Point operator-(const Point&a,const Point&b){return{a.x-b.x,a.y-b.y};}inline Point operator*(const Point&a,const Q&s){return{a.x*s,a.y*s};}
inline Q cross(const Point&a,const Point&b){return a.x*b.y-a.y*b.x;}inline Q dot(const Point&a,const Point&b){return a.x*b.x+a.y*b.y;}
struct Curve {Polynomial x,y;Vector<Point>controls;Curve()=default;explicit Curve(PolynomialContext&c):x(c),y(c),controls(c.numbers){}Context*context()const{return x.context();}PolynomialContext*owner()const{return x.owner();}};
inline Polynomial linear(PolynomialContext&c,const Q&a,const Q&b){Polynomial r(c);r.coefficients.push_back(a.owned(c.numbers));r.coefficients.push_back(b.owned(c.numbers));r.trim();return r;}
inline Point at(const Curve&c,const Q&t){return{evaluate(c.x,t),evaluate(c.y,t)};}inline Point tangent(const Curve&c,const Q&t){return{evaluate(derivative(c.x),t),evaluate(derivative(c.y),t)};}
inline Curve from_controls(PolynomialContext&c,const Point*controls,uint32_t count){Curve r(c);if(!controls||count<2||count>4){c.numbers.fail(SA_INK_INVALID);return r;}uint32_t n=count-1;Polynomial t=linear(c,Q(0),Q(1)),u=linear(c,Q(1),Q(-1));for(uint32_t i=0;i<=n&&c.numbers.status==SA_INK_OK;i++){r.controls.push_back({controls[i].x.owned(c.numbers),controls[i].y.owned(c.numbers)});uint32_t choose=1;for(uint32_t k=0;k<i;k++)choose=choose*(n-k)/(k+1);Polynomial p=Polynomial::scalar(c,choose);for(uint32_t k=0;k<i;k++)p=p*t;for(uint32_t k=i;k<n;k++)p=p*u;r.x=r.x+scale(p,controls[i].x);r.y=r.y+scale(p,controls[i].y);}return r;}
inline Curve restricted(const Curve&source,const Q&a,const Q&b){if(!source.owner())return{};auto&c=*source.owner();Curve r(c);Polynomial map=linear(c,a,b-a);r.x=compose(source.x,map);r.y=compose(source.y,map);int n=r.x.degree()>r.y.degree()?r.x.degree():r.y.degree();if(n<0)n=0;for(int i=0;i<=n&&c.numbers.status==SA_INK_OK;i++){Q x=Q::from_signed(c.numbers,0),y=x;for(int k=0;k<=i;k++){uint32_t numerator=1,denominator=1;for(int j=0;j<k;j++){numerator=numerator*uint32_t(i-j)/uint32_t(j+1);denominator=denominator*uint32_t(n-j)/uint32_t(j+1);}Q weight(Integer::from(c.numbers,numerator),Integer::from(c.numbers,denominator));x+=r.x[k]*weight;y+=r.y[k]*weight;}r.controls.push_back({x,y});}return r;}
inline bool exact_equal(const Q&a,const Q&b){return a.numerator()==b.numerator()&&a.denominator()==b.denominator();}
inline bool exact_equal(const Polynomial&a,const Polynomial&b){if(a.degree()!=b.degree())return false;for(int i=0;i<=a.degree();i++)if(!exact_equal(a[i],b[i]))return false;return true;}
inline bool exact_equal(const Curve&a,const Curve&b){return exact_equal(a.x,b.x)&&exact_equal(a.y,b.y);}
inline uint64_t mix(uint64_t hash,uint32_t word){return(hash^word)*1099511628211ull;}
inline uint64_t hash_integer(uint64_t h,const Integer&v){h=mix(h,uint32_t(v.sign()));h=mix(h,v.size());for(uint32_t i=0;i<v.size();i++)h=mix(h,v.data()[i]);return h;}
inline uint64_t hash_polynomial(uint64_t h,const Polynomial&p){h=mix(h,p.coefficients.size());for(const Q&q:p.coefficients){h=hash_integer(h,q.numerator());h=hash_integer(h,q.denominator());}return h;}
inline uint64_t hash_curve(const Curve&c){return hash_polynomial(hash_polynomial(1469598103934665603ull,c.x),c.y);}
inline int compare_polynomial(const Polynomial&a,const Polynomial&b){if(a.degree()!=b.degree())return a.degree()<b.degree()?-1:1;for(int i=0;i<=a.degree();i++){int c=a[i].compare(b[i]);if(c)return c;}return 0;}
inline int compare_curve(const Curve&a,const Curve&b){int x=compare_polynomial(a.x,b.x);return x?x:compare_polynomial(a.y,b.y);}
inline Vector<Polynomial> equation(const Polynomial&a,const Polynomial&b){auto*c=poly_owner(a,b);if(!c)return{};Vector<Polynomial>r(c->numbers);uint32_t count=b.degree()<0?1:uint32_t(b.degree()+1);r.resize(count);r[0]=a-Polynomial(*c,b[0]);for(uint32_t i=1;i<count;i++)r[i]=Polynomial(*c,-b[(int)i]);while(r.size()>1&&r.back().zero()&&c->numbers.status==SA_INK_OK)r.pop_back();return r;}
struct Correspondence {RationalFunction parameter;Polynomial result,forbidden;bool complete=false;};
inline Vector<Polynomial> pseudo_remainder(Vector<Polynomial>a,const Vector<Polynomial>&b,Polynomial&forbidden){auto*c=forbidden.owner();if(!c||b.empty())return a;forbidden=forbidden*b.back();while(!a.empty()&&a.size()>=b.size()&&c->numbers.status==SA_INK_OK){uint32_t shift=a.size()-b.size();Polynomial leading=a.back();for(uint32_t i=0;i<a.size();i++)a[i]=a[i]*b.back();for(uint32_t i=0;i<b.size()&&c->numbers.status==SA_INK_OK;i++)a[i+shift]=a[i+shift]-leading*b[i];while(!a.empty()&&a.back().zero()&&c->numbers.status==SA_INK_OK)a.pop_back();}
 if(!a.empty()&&c->numbers.status==SA_INK_OK){Polynomial content(*c);for(const auto&p:a)content=gcd(content,p);if(!content.zero()){if(content.degree()>0)forbidden=forbidden*content;for(uint32_t i=0;i<a.size()&&c->numbers.status==SA_INK_OK;i++)a[i]=exact_divide(a[i],content);}}return a;}
inline Correspondence correspondence(const Curve&a,const Curve&b){auto*c=a.owner();if(!c||b.owner()!=c){if(c)c->numbers.fail(SA_INK_INVALID);return{};}if((b.x.degree()>b.y.degree()?b.x.degree():b.y.degree())==1){bool x=b.x.degree()==1;const auto&v=x?b.x:b.y;RationalFunction u(scale((x?a.x:a.y)-Polynomial(*c,v[0]),Q(1)/v[1]));auto other=substitute(x?b.y:b.x,u)-RationalFunction(x?a.y:a.x);return{u,other.numerator,Polynomial::scalar(*c,1),c->numbers.status==SA_INK_OK};}
 auto px=equation(a.x,b.x),py=equation(a.y,b.y);Polynomial result=resultant(px,py);if(result.zero())return{RationalFunction(Polynomial(*c)),result,Polynomial::scalar(*c,1),c->numbers.status==SA_INK_OK};auto P=px,Qrow=py;if(P.size()<Qrow.size()){auto swap=static_cast<Vector<Polynomial>&&>(P);P=static_cast<Vector<Polynomial>&&>(Qrow);Qrow=static_cast<Vector<Polynomial>&&>(swap);}RationalFunction relation{Polynomial(*c)};Polynomial forbidden=Polynomial::scalar(*c,1);bool found=false;while(Qrow.size()>1&&c->numbers.status==SA_INK_OK){if(Qrow.size()==2){relation=RationalFunction(-Qrow[0],Qrow[1]);forbidden=forbidden*Qrow[1];found=true;break;}auto remainder=pseudo_remainder(P,Qrow,forbidden);P=static_cast<Vector<Polynomial>&&>(Qrow);Qrow=static_cast<Vector<Polynomial>&&>(remainder);}if(!found&&c->numbers.status==SA_INK_OK)c->numbers.fail(SA_INK_RANGE);return{relation,result,squarefree(forbidden),found&&c->numbers.status==SA_INK_OK};}
inline bool affine_coincidence(const Curve&a,const Curve&b,Q&alpha,Q&beta){auto*c=a.owner();if(!c||b.owner()!=c)return false;int degree=a.x.degree()>a.y.degree()?a.x.degree():a.y.degree();if(degree<1||degree>3||degree!=(b.x.degree()>b.y.degree()?b.x.degree():b.y.degree()))return false;const auto&A=a.x.degree()==degree?a.x:a.y;const auto&B=a.x.degree()==degree?b.x:b.y;if(B.degree()!=degree)return false;Q ratio=B[degree]/A[degree];if(!(degree&1)&&ratio<Q(0))return false;Q candidate=ratio;if(degree>1){bool np=false,dp=false;Q positive=ratio.absolute();Integer n=Integer::perfect_root(positive.numerator(),uint32_t(degree),np),d=Integer::perfect_root(positive.denominator(),uint32_t(degree),dp);if(!np||!dp||c->numbers.status!=SA_INK_OK)return false;candidate=Q(n,d);if(ratio<Q(0))candidate=-candidate;}for(int sign=1;sign>=-1;sign-=2){if((degree&1)&&sign<0)break;Q z=candidate*Q(sign);if(z.zero())continue;Q power=Q::from_signed(c->numbers,1);for(int i=0;i<degree-1;i++)power*=z;Q offset=(B[degree-1]/power-A[degree-1])/(Q(degree)*A[degree]);if(exact_equal(restricted(a,offset,offset+z),b)){alpha=z;beta=offset;return true;}}return false;}
inline bool try_divide(Interval a,Interval b,Interval&out){if(b.lower<=Q(0)&&b.upper>=Q(0))return false;out=multiply(a,{Q(1)/b.upper,Q(1)/b.lower});return true;}
inline bool overlap(Interval a,Interval b){return a.lower<=b.upper&&b.lower<=a.upper;}
struct PairHit{Root a,b;Context*context()const{return a.context();}};
struct PairProof{bool complete=false,coincident=false;Q alpha,beta;Vector<PairHit>hits;PairProof()=default;explicit PairProof(PolynomialContext&c):alpha(Q::from_signed(c.numbers,0)),beta(alpha),hits(c.numbers){}Context*context()const{return hits.context();}};
inline PairProof directional_intersections(const Curve&a,const Curve&b){auto&c=*a.owner();PairProof proof(c);auto relation=correspondence(a,b);if(!relation.complete||c.numbers.status!=SA_INK_OK)return proof;if(relation.result.zero()){c.numbers.fail(SA_INK_RANGE);return proof;}auto rt=squarefree(relation.result);auto gx=substitute(b.x,relation.parameter)-RationalFunction(a.x),gy=substitute(b.y,relation.parameter)-RationalFunction(a.y);auto valid=gcd(gcd(rt,gx.numerator),gy.numerator);auto reverse=resultant(equation(b.x,a.x),equation(b.y,a.y));auto ur=roots(reverse);auto tr=roots(rt);Q width(Integer::from(c.numbers,1),Integer::from(c.numbers,1).shifted_left(48));
 for(Root t:tr){
  if(c.numbers.status!=SA_INK_OK)return proof;if(root_of(t,relation.forbidden)||!root_of(t,valid)){c.numbers.fail(SA_INK_RANGE);return proof;}
  // A rational image interval and two isolated reverse-root intervals may
  // share a non-root endpoint. Closed interval overlap is only a candidate,
  // never proof that the first candidate is the actual corresponding root.
  bool at_zero=root_of(t,relation.parameter.numerator),at_one=root_of(t,relation.parameter.numerator-relation.parameter.denominator),outside=false;int match=-1;
  if(at_zero&&at_one){c.numbers.fail(SA_INK_RANGE);return proof;}
  for(uint32_t round=0;round<200&&c.numbers.status==SA_INK_OK;round++){
   Interval ui;bool mapped=true;if(at_zero)ui={Q(0),Q(0)};else if(at_one)ui={Q(1),Q(1)};else mapped=try_divide(evaluate(relation.parameter.numerator,Interval{t.lower,t.upper}),evaluate(relation.parameter.denominator,Interval{t.lower,t.upper}),ui);
   if(mapped&&(ui.upper<Q(0)||ui.lower>Q(1))){outside=true;break;}
   if(mapped&&ui.lower>=Q(0)&&ui.upper<=Q(1)&&ui.upper-ui.lower<width){
    uint32_t count=0;int candidate=-1;for(uint32_t i=0;i<ur.size()&&c.numbers.status==SA_INK_OK;i++)if(overlap(ui,{ur[i].lower,ur[i].upper})){candidate=int(i);++count;}
    if(count==1){match=candidate;break;}
    // Every valid actual image is a reverse-resultant root, so no candidate
    // is a failed certificate. Multiple candidates require more evidence.
    if(!count){c.numbers.fail(SA_INK_RANGE);return proof;}
    if(round+1<200)for(uint32_t i=0;i<ur.size()&&c.numbers.status==SA_INK_OK;i++)if(overlap(ui,{ur[i].lower,ur[i].upper}))refine(ur[i]);
   }
   if(round+1<200)refine(t);
  }
  if(c.numbers.status!=SA_INK_OK)return proof;if(outside)continue;if(match<0){c.numbers.fail(SA_INK_RANGE);return proof;}proof.hits.push_back({t,ur[uint32_t(match)]});
 }
 proof.complete=c.numbers.status==SA_INK_OK;return proof;}
inline PairProof curve_pair(const Curve&a,const Curve&b){if(!a.owner()||a.owner()!=b.owner()){if(a.context())a.context()->fail(SA_INK_INVALID);return{};}auto&c=*a.owner();PairProof result(c);if(c.numbers.status!=SA_INK_OK)return result;if(affine_coincidence(a,b,result.alpha,result.beta)){result.coincident=true;result.complete=c.numbers.status==SA_INK_OK;return result;}if(c.numbers.status!=SA_INK_OK)return result;
 // A singular rational-univariate projection may become regular in the other
 // direction (for example a line through a cubic double point). The first
 // attempt's private records are destroyed before retry; budget use is kept.
 {auto attempt=directional_intersections(a,b);if(attempt.complete||c.numbers.status!=SA_INK_RANGE)return attempt;}
 c.numbers.status=SA_INK_OK;auto reverse=directional_intersections(b,a);if(!reverse.complete)return reverse;for(const auto&hit:reverse.hits)result.hits.push_back({hit.b,hit.a});result.complete=c.numbers.status==SA_INK_OK;return result;}
}
#endif
